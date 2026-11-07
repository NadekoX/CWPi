import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { type SandboxRuntimeConfig, VENDORED_SRT_WIN_EXE } from "@anthropic-ai/sandbox-runtime";
import { resolveWorkspacePath, type SandboxCredential } from "@cwpi/policy";
import { execa } from "execa";
import { isWindowsShellEnabled } from "./windows-shell-setup.js";

interface SandboxBoundaryInput {
  workspaceRoot: string;
  protectedPaths: readonly string[];
  allowedDomains: readonly string[];
  deniedDomains?: readonly string[];
  credentials?: readonly SandboxCredentialInput[];
  isWorkspaceWritable?: boolean;
  readPaths?: readonly string[];
  onNetworkApproval?: (request: { host: string; port?: number }) => Promise<boolean>;
}

interface SandboxCredentialInput {
  injectHosts?: readonly string[];
  name: string;
  value: string;
}

export interface SandboxCommandInput {
  commandId: string;
  command: string;
  workspaceRoot: string;
  protectedPaths: readonly string[];
  allowedDomains: readonly string[];
  deniedDomains?: readonly string[];
  credentials?: readonly SandboxCredential[];
  isWorkspaceWritable?: boolean;
  onNetworkApproval?: (request: { host: string; port?: number }) => Promise<boolean>;
  readPaths?: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  onOutput: (chunk: string) => void;
}

export interface SandboxProcessInput extends SandboxBoundaryInput {
  commandId: string;
  command: string;
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface SandboxedProcess {
  process: ChildProcessWithoutNullStreams;
  close(): Promise<void>;
  getViolations?(): readonly string[];
}

const ENVIRONMENT_NAMES = ["LANG", "LC_ALL", "PATH", "TERM"] as const;
const WINDOWS_WORKER_ENVIRONMENT_NAMES = ["LOCALAPPDATA", "SystemRoot", "USERPROFILE"] as const;
let windowsShellActive = false;

/**
 * 作用：
 * 1、解析并固定真实 workspaceRoot
 * 2、生成文件系统规则：- 允许读取 workspace、临时目录、Node 运行目录和额外资源。
    - 拒绝读取真实 HOME、workspace 同级目录和 daemon 私有目录。
    - read_only 只允许写临时目录。
    - workspace_write 额外允许写 workspace。
 * 3、生成网络 allow/deny 规则
 * 4、配置 SRT 凭据代理。
 * 5、只继承 PATH、语言和终端等少量环境变量。
 * 6、把 HOME、TMPDIR 指向临时目录。
 */
async function prepareSandbox(input: SandboxBoundaryInput) {
  const workspaceRoot = await resolveWorkspacePath({
    workspaceRoot: input.workspaceRoot,
    path: ".",
    protectedPaths: input.protectedPaths,
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "CWPi-sandbox-"));
  // SRT 的 allow 不接受全局 `*`；空 allow 由 ask callback 放行，凭据目标仍需进入配置完成 SRT 校验。
  const allowedDomains =
    input.allowedDomains.length === 0
      ? [...new Set((input.credentials ?? []).flatMap(({ injectHosts }) => injectHosts ?? []))]
      : [...input.allowedDomains];
  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains,
      deniedDomains: [...(input.deniedDomains ?? [])],
      deniedDomainReasons: Object.fromEntries(
        (input.deniedDomains ?? []).map((entry) => [entry, `CWPi deny rule: ${entry}`]),
      ),
      ...((input.credentials?.length ?? 0) > 0 ? { tlsTerminate: {} } : {}),
    },
    filesystem: {
      denyRead: [homedir(), dirname(workspaceRoot), ...input.protectedPaths],
      allowRead: [
        workspaceRoot,
        temporaryRoot,
        dirname(process.execPath),
        ...(input.readPaths ?? []),
      ],
      allowWrite: [...(input.isWorkspaceWritable === false ? [] : [workspaceRoot]), temporaryRoot],
      denyWrite: [
        ...input.protectedPaths,
        ...(process.platform === "win32" ? [VENDORED_SRT_WIN_EXE] : []),
      ],
    },
    ...((input.credentials?.length ?? 0) > 0
      ? {
          credentials: {
            envVars: input.credentials?.map(({ injectHosts, name }) => ({
              ...(injectHosts === undefined ? {} : { injectHosts: [...injectHosts] }),
              mode: "mask" as const,
              name,
            })),
          },
        }
      : {}),
    ...(process.platform === "win32"
      ? { windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } } }
      : {}),
  };
  const inheritedNames =
    process.platform === "win32"
      ? [...ENVIRONMENT_NAMES, ...WINDOWS_WORKER_ENVIRONMENT_NAMES]
      : ENVIRONMENT_NAMES;
  return {
    config,
    environment: {
      ...Object.fromEntries(
        inheritedNames.flatMap((name) =>
          process.env[name] === undefined ? [] : [[name, process.env[name]]],
        ),
      ),
      HOME: temporaryRoot,
      TMPDIR: temporaryRoot,
      TEMP: temporaryRoot,
      TMP: temporaryRoot,
      CLAUDE_CODE_TMPDIR: temporaryRoot,
    },
    temporaryRoot,
    workspaceRoot,
  };
}

/** 独立进程持有 SRT 的全局管理器，避免并发 workspace 串用文件权限和网络代理。 */
export async function runSandboxedCommand(input: SandboxCommandInput) {
  input.signal?.throwIfAborted();
  const { config, environment, temporaryRoot, workspaceRoot } = await prepareSandbox(input);
  try {
    const subprocess = execa(
      process.execPath,
      [fileURLToPath(new URL("./sandbox-worker.mjs", import.meta.url))],
      {
        cwd: workspaceRoot,
        detached: true,
        env: environment,
        extendEnv: false,
        ipcInput: {
          command: input.command,
          commandId: input.commandId,
          config,
          credentials: input.credentials ?? [],
          mode: "command",
          type: "start",
        },
        ipc: true,
        all: true,
        maxBuffer: input.maxOutputBytes,
        reject: false,
        timeout: input.timeoutMs,
        killSignal: "SIGKILL",
        ...(input.signal === undefined ? {} : { cancelSignal: input.signal }),
      },
    );
    let hasStoppedGroup = false;
    let hasCleanupError = false;
    let sandboxProcessPid: number | undefined;
    let violations: string[] = [];
    // 正常退出也清理后台子进程；进程组信号不依赖 Shell 是否主动转发。
    const stopGroup = () => {
      if (subprocess.pid === undefined || hasStoppedGroup) return;
      hasStoppedGroup = true;
      const pids =
        process.platform === "win32" ? [sandboxProcessPid, subprocess.pid] : [-subprocess.pid];
      for (const pid of pids) {
        if (pid === undefined) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch (error: unknown) {
          hasCleanupError ||= !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          );
        }
      }
    };
    subprocess.all?.on("data", (chunk: Buffer | string) => {
      input.onOutput(chunk.toString());
    });
    const ipcTask = (async () => {
      for await (const message of subprocess.getEachMessage()) {
        if (typeof message !== "object" || message === null || !("type" in message)) continue;
        if (
          message.type === "network-approval" &&
          "requestId" in message &&
          typeof message.requestId === "string" &&
          "host" in message &&
          typeof message.host === "string"
        ) {
          const port =
            "port" in message && typeof message.port === "number" ? message.port : undefined;
          let allowed = input.allowedDomains.length === 0;
          try {
            if (!allowed) {
              allowed =
                (await input.onNetworkApproval?.({
                  host: message.host,
                  ...(port === undefined ? {} : { port }),
                })) ?? false;
            }
          } finally {
            await subprocess.sendMessage({
              allowed,
              requestId: message.requestId,
              type: "network-approval-result",
            });
          }
        }
        if (
          message.type === "sandbox-process" &&
          "pid" in message &&
          typeof message.pid === "number"
        ) {
          sandboxProcessPid = message.pid;
        }
        if (message.type === "violations" && "lines" in message && Array.isArray(message.lines)) {
          violations = message.lines.filter((line): line is string => typeof line === "string");
        }
      }
    })();
    process.once("exit", stopGroup);
    subprocess.once("exit", stopGroup);
    const result = await subprocess.finally(() => {
      process.removeListener("exit", stopGroup);
      stopGroup();
    });
    await ipcTask;
    if (hasCleanupError) throw new Error("SANDBOX_CLEANUP_FAILED: 无法终止沙箱进程组");
    return {
      ...result,
      violations,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function spawnSandboxedShell(
  input: Omit<SandboxProcessInput, "args" | "environment"> & { windowsShellEnabled?: boolean },
): Promise<SandboxedProcess> {
  if (process.platform !== "win32") {
    return spawnSandboxedProcess({
      ...input,
      args: ["-lc", input.command],
      command: process.env.SHELL ?? "/bin/sh",
      environment: {},
    });
  }

  input.signal?.throwIfAborted();
  if (!isWindowsShellEnabled(input.windowsShellEnabled)) {
    throw new Error("SANDBOX_PLATFORM_UNAVAILABLE: 请在设置 → 沙箱中启用 Windows Shell 沙箱预览");
  }
  // SRT keeps workspace write grants after reset and other sessions can read those roots.
  if (input.isWorkspaceWritable !== false) {
    throw new Error("SANDBOX_WINDOWS_READ_ONLY_REQUIRED: Windows 沙箱 Shell 预览仅支持只读工作区");
  }
  if (windowsShellActive) {
    throw new Error("SANDBOX_WINDOWS_BUSY: 请等待当前 Windows 沙箱命令结束");
  }
  windowsShellActive = true;
  return spawnSandboxWorker({ ...input, args: [], environment: {} }, "windows-shell");
}

/** 长驻进程的 stdio 只作为协议管道转发。 */
export async function spawnSandboxedProcess(input: SandboxProcessInput): Promise<SandboxedProcess> {
  input.signal?.throwIfAborted();
  if (process.platform === "win32") {
    throw new Error("SANDBOX_PLATFORM_UNAVAILABLE: 当前平台尚未验证长驻沙箱进程回收");
  }
  return spawnSandboxWorker(input, "process");
}

async function spawnSandboxWorker(
  input: SandboxProcessInput,
  mode: "process" | "windows-shell",
): Promise<SandboxedProcess> {
  const isWindowsShell = mode === "windows-shell";
  const { config, environment, temporaryRoot, workspaceRoot } = await prepareSandbox(input).catch(
    (error: unknown) => {
      if (isWindowsShell) windowsShellActive = false;
      throw error;
    },
  );
  const subprocess = spawn(
    process.execPath,
    [fileURLToPath(new URL("./sandbox-worker.mjs", import.meta.url))],
    {
      cwd: workspaceRoot,
      detached: !isWindowsShell,
      env: environment,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  if (subprocess.stdin === null || subprocess.stdout === null || subprocess.stderr === null) {
    subprocess.kill("SIGKILL");
    await rm(temporaryRoot, { recursive: true, force: true });
    if (isWindowsShell) windowsShellActive = false;
    throw new Error("SANDBOX_PROCESS_START_FAILED: 沙箱 worker 管道不可用");
  }
  const sandboxWorker = subprocess as ChildProcessWithoutNullStreams;
  let violations: string[] = [];
  let closing: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let brokerPid: number | undefined;
  const exited = new Promise<void>((resolve) => subprocess.once("close", () => resolve()));
  const removeTemporaryRoot = () =>
    (cleanup ??= (async () => {
      if (isWindowsShell && brokerPid !== undefined) await waitForWindowsBrokerExit(brokerPid);
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: isWindowsShell ? 5 : 0 });
      if (isWindowsShell) windowsShellActive = false;
    })());
  const signalGroup = (signal: NodeJS.Signals) => {
    if (subprocess.pid === undefined) return;
    if (isWindowsShell) {
      // SRT owns the native job and ends it when its session holder (this worker) exits.
      subprocess.kill();
      return;
    }
    try {
      process.kill(-subprocess.pid, signal);
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  const close = () =>
    (closing ??= (async () => {
      try {
        if (subprocess.exitCode === null && subprocess.signalCode === null) {
          sandboxWorker.stdin.end();
          await Promise.race([exited, delay(250)]);
          if (subprocess.exitCode === null && subprocess.signalCode === null) {
            signalGroup("SIGTERM");
            await Promise.race([exited, delay(500)]);
            if (subprocess.exitCode === null && subprocess.signalCode === null) {
              signalGroup("SIGKILL");
              await Promise.race([
                exited,
                delay(1_500).then(() => {
                  throw new Error("SANDBOX_CLEANUP_FAILED: 沙箱进程未在期限内退出");
                }),
              ]);
            }
          }
        }
        if (isWindowsShell) await exited;
      } finally {
        sandboxWorker.stdin.destroy();
        sandboxWorker.stdout.destroy();
        sandboxWorker.stderr.destroy();
        await removeTemporaryRoot();
      }
    })());
  subprocess.once("exit", () => {
    if (!isWindowsShell) void removeTemporaryRoot().catch(() => {});
  });
  subprocess.once("close", () => {
    if (isWindowsShell) void removeTemporaryRoot().catch(() => {});
  });

  const send = (message: object) =>
    new Promise<void>((resolve, reject) => {
      subprocess.send(message, (error) => (error ? reject(error) : resolve()));
    });
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let startupError = "";
  const captureStartupError = (chunk: Buffer) => {
    startupError = `${startupError}${chunk.toString()}`.slice(0, 512);
  };
  sandboxWorker.stderr.on("data", captureStartupError);
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  subprocess.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null || !("type" in message)) return;
    if (message.type === "sandbox-process") {
      if ("pid" in message && typeof message.pid === "number") brokerPid = message.pid;
      sandboxWorker.stderr.removeListener("data", captureStartupError);
      resolveReady?.();
      return;
    }
    if (message.type === "violations" && "lines" in message && Array.isArray(message.lines)) {
      violations = message.lines.filter((line): line is string => typeof line === "string");
      return;
    }
    if (
      message.type === "network-approval" &&
      "requestId" in message &&
      typeof message.requestId === "string" &&
      "host" in message &&
      typeof message.host === "string"
    ) {
      const host = message.host;
      const requestId = message.requestId;
      const port = "port" in message && typeof message.port === "number" ? message.port : undefined;
      void (async () => {
        const allowed =
          input.allowedDomains.length === 0 ||
          ((await input.onNetworkApproval?.({
            host,
            ...(port === undefined ? {} : { port }),
          })) ??
            false);
        await send({
          allowed,
          requestId,
          type: "network-approval-result",
        });
      })().catch(() => signalGroup("SIGKILL"));
    }
  });
  subprocess.once("error", () =>
    rejectReady?.(new Error("SANDBOX_PROCESS_START_FAILED: 无法启动沙箱 worker")),
  );
  subprocess.once("close", () =>
    rejectReady?.(
      new Error(
        startupError.trim() || "SANDBOX_PROCESS_START_FAILED: 沙箱 worker 在服务就绪前退出",
      ),
    ),
  );
  const abort = () => {
    signalGroup("SIGKILL");
    rejectReady?.(new Error("SANDBOX_PROCESS_ABORTED: 沙箱进程启动已取消"));
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (input.signal?.aborted) abort();
    await Promise.all([
      send({
        args: [...input.args],
        command: input.command,
        commandId: input.commandId,
        config,
        credentials: input.credentials ?? [],
        environment: input.environment,
        mode,
        type: "start",
      }),
      ready,
    ]);
    input.signal?.throwIfAborted();
    return {
      process: sandboxWorker,
      close,
      getViolations: () => violations,
    };
  } catch (error: unknown) {
    await close();
    input.signal?.throwIfAborted();
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

async function waitForWindowsBrokerExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  do {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error("SANDBOX_CLEANUP_FAILED: Windows 沙箱进程未在期限内退出");
}
