import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, join, parse, resolve } from "node:path";
import { resolveComputerUseHelperPath } from "@cwpi/computer-use";
import { isPathWithin } from "@cwpi/policy";
import { McpAuthMode, McpTransport } from "../../schemas/mcp.js";
import type { McpConnectionContext } from "../client-manager.js";
import { McpError, McpErrorCode } from "../errors.js";
import type { McpProcessLaunch } from "../transports/stdio.js";
import { isComputerUseMcpServer } from "./computer-use-server.js";
import { validateMcpCredential } from "./credential.js";

const NODE_DIRECTORY = dirname(process.execPath);
const WINDOWS_ROOT = /^[a-z]:[\\/]/iu.test(process.env.SystemRoot ?? "")
  ? resolve(process.env.SystemRoot ?? "C:\\Windows")
  : "C:\\Windows";
const WINDOWS_SYSTEM_DIRECTORY = join(WINDOWS_ROOT, "System32");
const PROGRAM_FILES = process.env.ProgramFiles ?? "C:\\Program Files";
const WINDOWS_NODE_DIRECTORIES = /^[a-z]:[\\/]/iu.test(PROGRAM_FILES)
  ? [...new Set([NODE_DIRECTORY, resolve(PROGRAM_FILES, "nodejs")])]
  : [NODE_DIRECTORY];

/** 固定搜索路径不读取 daemon PATH；不允许项目内的同名程序劫持启动命令。 */
const MCP_EXECUTABLE_DIRECTORIES =
  process.platform === "win32"
    ? [...WINDOWS_NODE_DIRECTORIES, WINDOWS_SYSTEM_DIRECTORY]
    : [NODE_DIRECTORY, "/usr/local/bin", "/usr/bin", "/bin"];

async function findMcpFile(
  candidates: readonly string[],
  directory?: string,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate);
      if (directory !== undefined && !isPathWithin(directory, resolved)) continue;
      await access(resolved, constants.X_OK);
      if ((await stat(resolved)).isFile()) return resolved;
    } catch (error: unknown) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          ["ENOENT", "EACCES", "ENOTDIR"].includes(String(error.code))
        )
      )
        throw error;
    }
  }
}

async function resolveWindowsLaunch(
  command: string,
  args: string[],
): Promise<{ command: string; args: string[] } | undefined> {
  if (isAbsolute(command)) {
    if (
      parse(command).root.length === 1 ||
      /^[\\/]{2}[?.][\\/]/u.test(command) ||
      extname(command).toLowerCase() !== ".exe"
    )
      return;
    const executable = await findMcpFile([command]);
    return executable === undefined ? undefined : { command: executable, args };
  }
  if (/[\\/:]/u.test(command) || command === "." || command === "..") return;

  const name = command.toLowerCase();
  if (name === "node" || name === "node.exe") return { command: process.execPath, args };
  if (name === "npx" || name === "npx.cmd") {
    for (const directory of WINDOWS_NODE_DIRECTORIES) {
      const node = await findMcpFile([join(directory, "node.exe")], directory);
      const cli = await findMcpFile(
        [join(directory, "node_modules", "npm", "bin", "npx-cli.js")],
        directory,
      );
      if (node !== undefined && cli !== undefined) return { command: node, args: [cli, ...args] };
    }
    throw new McpError(
      McpErrorCode.INVALID_CONFIG,
      "找不到配套的 Node.js 和 npx，请检查 Node.js 安装",
    );
  }
  if (/\.(?:bat|cmd|ps1)$/iu.test(command)) return;

  const filename = name.endsWith(".exe") ? command : `${command}.exe`;
  for (const directory of MCP_EXECUTABLE_DIRECTORIES) {
    const executable = await findMcpFile([join(directory, filename)], directory);
    if (executable !== undefined) return { command: executable, args };
  }
}

export async function prepareMcpProcessLaunch(
  context: McpConnectionContext,
  signal: AbortSignal,
): Promise<McpProcessLaunch> {
  signal.throwIfAborted();
  const config = context.server.config;
  if (config.transport !== McpTransport.STDIO)
    throw new McpError(McpErrorCode.INVALID_CONFIG, "MCP 本地进程配置无效");
  const credential =
    context.credential === undefined ? undefined : validateMcpCredential(context.credential);
  if (credential !== undefined && credential.material.mode !== McpAuthMode.STATIC) {
    throw new McpError(McpErrorCode.CREDENTIAL_INVALID, "stdio 服务仅支持环境变量凭据");
  }
  let cwd: string;
  let command: string | undefined;
  let args = [...config.args];
  const hasHostAccess = isComputerUseMcpServer(context.server);
  if (hasHostAccess && process.platform !== "win32") {
    throw new McpError(McpErrorCode.INVALID_CONFIG, "Computer Use 需要 Windows 11 本机登录会话");
  }
  try {
    cwd = await realpath(context.workspaceRoot);
    if (cwd !== resolve(context.workspaceRoot)) throw new Error("workspace identity changed");
    if (!(await stat(cwd)).isDirectory()) throw new Error("invalid workspace");
    if (hasHostAccess) {
      command = await findMcpFile([
        resolveComputerUseHelperPath(),
        join(NODE_DIRECTORY, `${config.command}.exe`),
      ]);
    } else if (process.platform === "win32") {
      const launch = await resolveWindowsLaunch(config.command, args);
      if (launch !== undefined) ({ command, args } = launch);
    } else {
      const candidates = isAbsolute(config.command)
        ? [config.command]
        : config.command.includes("/")
          ? []
          : MCP_EXECUTABLE_DIRECTORIES.map((directory) => join(directory, config.command));
      command = await findMcpFile(candidates);
    }
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    throw new McpError(McpErrorCode.INVALID_CONFIG, "MCP 工作区或启动程序不可访问");
  }
  if (command === undefined) {
    throw new McpError(
      McpErrorCode.INVALID_CONFIG,
      process.platform === "win32"
        ? "MCP 启动程序不存在或不可执行，请使用命令名或 .exe 完整绝对路径"
        : "MCP 启动程序不存在或不可执行，请使用绝对路径",
    );
  }
  signal.throwIfAborted();
  return {
    commandId: `mcp:${context.server.id}:${context.ownerId}`,
    command,
    args,
    cwd,
    environment: {
      PATH: MCP_EXECUTABLE_DIRECTORIES.join(delimiter),
      LANG: "en_US.UTF-8",
      ...(process.platform === "win32" ? { SystemRoot: WINDOWS_ROOT } : {}),
    },
    hasHostAccess,
    credentials:
      credential?.material.mode === McpAuthMode.STATIC ? credential.material.environment : {},
  };
}
