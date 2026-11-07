import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { SandboxManager, SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";
import { getOneMessage, sendMessage } from "execa";

/**
 * @typedef {{
 *   args?: string[],
 *   command: string,
 *   commandId: string,
 *   config: unknown,
 *   credentials: unknown[],
 *   environment?: Record<string, string>,
 *   mode: "command" | "process" | "windows-shell",
 *   type: "start"
 * }} SandboxWorkerInput
 */

/** @param {readonly string[]} values */
const quote = (values) =>
  values.map((value) => (value === "" ? "''" : `'${value.replaceAll("'", `'"'"'`)}'`)).join(" ");

// 配置通过父进程管道传入，不读取 workspace 或用户的 SRT 配置。
let stage = "input";
let isWindowsShell = false;
try {
  /** @type {unknown} */
  const input = await getOneMessage();
  if (
    typeof input !== "object" ||
    input === null ||
    !("type" in input) ||
    input.type !== "start" ||
    !("command" in input) ||
    typeof input.command !== "string" ||
    !input.command ||
    !("commandId" in input) ||
    typeof input.commandId !== "string" ||
    !input.commandId ||
    !("config" in input) ||
    !("credentials" in input) ||
    !Array.isArray(input.credentials) ||
    !("mode" in input) ||
    (input.mode !== "command" &&
      input.mode !== "process" &&
      !(input.mode === "windows-shell" && process.platform === "win32")) ||
    (input.mode === "process" &&
      (!("args" in input) ||
        !Array.isArray(input.args) ||
        !input.args.every((value) => typeof value === "string" && !value.includes("\0")) ||
        !("environment" in input) ||
        typeof input.environment !== "object" ||
        input.environment === null ||
        !Object.entries(input.environment).every(
          ([name, value]) =>
            /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) &&
            typeof value === "string" &&
            !value.includes("\0"),
        )))
  ) {
    throw new Error("沙箱输入无效");
  }
  const sandboxInput = /** @type {SandboxWorkerInput} */ (input);
  isWindowsShell = sandboxInput.mode === "windows-shell";
  if (isWindowsShell) {
    // srt-win binds its native job to this worker. Exit even if the daemon crashed.
    process.once("disconnect", () => process.exit(1));
    if (!process.connected) process.exit(1);
  }
  const config = SandboxRuntimeConfigSchema.parse(sandboxInput.config);
  if (sandboxInput.mode === "process") {
    for (const [name, value] of Object.entries(sandboxInput.environment ?? {}))
      process.env[name] = value;
  }
  for (const credential of sandboxInput.credentials) {
    if (
      typeof credential !== "object" ||
      credential === null ||
      !("name" in credential) ||
      typeof credential.name !== "string" ||
      !("value" in credential) ||
      typeof credential.value !== "string"
    ) {
      throw new Error("沙箱凭据配置无效");
    }
  }
  const credentials = /** @type {{name: string, value: string}[]} */ (sandboxInput.credentials);
  for (const credential of credentials) {
    process.env[credential.name] = credential.value;
  }
  stage = "initialization";
  /** @param {{host: string, port: number | undefined}} request */
  const askNetwork = async ({ host, port }) => {
    const requestId = randomUUID();
    await sendMessage({ host, port, requestId, type: "network-approval" });
    const response = await getOneMessage({
      filter: (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "network-approval-result" &&
        "requestId" in message &&
        message.requestId === requestId,
    });
    return (
      typeof response === "object" &&
      response !== null &&
      "allowed" in response &&
      response.allowed === true
    );
  };
  await SandboxManager.initialize(config, askNetwork, true);
  if (isWindowsShell && SandboxManager.getWindowsProfileRead() === "granted") {
    throw new Error("SANDBOX_WINDOWS_PROFILE_GRANT: 当前 Windows 沙箱已授予用户目录读取权限");
  }
  stage = "configuration";
  const command =
    sandboxInput.mode === "process"
      ? quote([sandboxInput.command, ...(sandboxInput.args ?? [])])
      : sandboxInput.command;
  const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
    command,
    undefined,
    undefined,
    undefined,
    process.cwd(),
    { commandId: sandboxInput.commandId, commandText: sandboxInput.command },
  );
  // SRT 已把真实值保存在宿主代理的哨兵注册表中；启动目标前清除 worker 与外层 runner 环境副本。
  for (const credential of credentials) {
    delete process.env[credential.name];
    delete env[credential.name];
  }
  const executable = argv[0];
  if (executable === undefined) throw new Error("沙箱未返回可执行命令");
  if (isWindowsShell) {
    const optionEnd = argv.indexOf("--");
    const options = argv.slice(1, optionEnd);
    const holder = options.indexOf("--held-by");
    if (
      optionEnd < 0 ||
      holder < 0 ||
      options[holder + 1] !== String(process.pid) ||
      !options.includes("--write-restricted-token")
    ) {
      throw new Error("SANDBOX_WINDOWS_SESSION_UNAVAILABLE: srt-win 未绑定当前沙箱会话");
    }
  }
  stage = "execution";
  const hasPipes = sandboxInput.mode !== "command";
  const child = spawn(executable, argv.slice(1), {
    cwd: process.cwd(),
    env,
    shell: false,
    stdio: hasPipes ? ["pipe", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  const completed = new Promise((resolve) =>
    child.once(isWindowsShell ? "close" : "exit", (code) => resolve(code ?? 1)),
  );
  if (hasPipes) {
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      throw new Error("沙箱进程管道不可用");
    }
    process.stdin.pipe(child.stdin);
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  }
  await once(child, "spawn");
  await sendMessage({ pid: child.pid, type: "sandbox-process" });
  process.exitCode = await completed;
  await sendMessage({
    lines: SandboxManager.getSandboxViolationStore()
      .getViolationsForCommand(sandboxInput.commandId)
      .map(({ line }) => line),
    type: "violations",
  });
} catch (error) {
  const code =
    stage === "input"
      ? "SANDBOX_INPUT_INVALID"
      : stage === "initialization"
        ? "SANDBOX_INITIALIZATION_FAILED"
        : stage === "configuration"
          ? "SANDBOX_CONFIGURATION_FAILED"
          : "SANDBOX_COMMAND_START_FAILED";
  const causeCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]+$/i.test(error.code)
      ? ` (${error.code})`
      : "";
  let detail = "";
  if (isWindowsShell && error instanceof Error && error.message.startsWith("SANDBOX_WINDOWS_")) {
    detail = ` ${error.message}`;
  } else if (isWindowsShell && stage === "initialization") {
    detail =
      " 请检查 Windows 沙箱是否已用项目固定版本的 srt 执行 windows-install --skip-profile-grant。";
  }
  process.stderr.write(`${code}${causeCode}: 沙箱在 ${stage} 阶段失败。${detail}\n`);
  process.exitCode = 1;
} finally {
  try {
    await SandboxManager.reset();
  } catch {
    process.stderr.write("SANDBOX_CLEANUP_FAILED: 沙箱资源清理失败。\n");
    process.exitCode = 1;
  }
}
// 后台命令可能持有 stdout；父进程在收到 worker 退出后清理整个进程组。
process.exit(process.exitCode ?? 1);
