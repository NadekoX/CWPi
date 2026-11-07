import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("桌面安装包必须使用 Windows x64 Node 构建");
}
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请通过 pnpm prepare:bundle 执行");

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const tauriRoot = join(desktopRoot, "src-tauri");
const daemonRoot = join(tauriRoot, "resources", "daemon");
const binariesRoot = join(tauriRoot, "binaries");
const computerUseBinary = join(
  workspaceRoot,
  "packages",
  "computer-use",
  "native",
  "target",
  "release",
  "pi-computer-use-helper.exe",
);
const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8",
}).trim();
const sidecarPath = join(binariesRoot, `cwpi-node-${targetTriple}.exe`);
const computerUseSidecarPath = join(binariesRoot, `pi-computer-use-helper-${targetTriple}.exe`);

if (Number(process.versions.node.split(".")[0]) < 24) {
  throw new Error("CWPi desktop packaging requires Node.js 24 or newer");
}
if (targetTriple !== "x86_64-pc-windows-msvc") {
  throw new Error("桌面安装包需要 x86_64-pc-windows-msvc Rust 工具链");
}

rmSync(daemonRoot, { force: true, recursive: true });
mkdirSync(daemonRoot, { recursive: true });
execFileSync(
  process.execPath,
  [
    pnpm,
    "--config.node-linker=hoisted",
    "--filter",
    "@cwpi/daemon",
    "deploy",
    daemonRoot,
    "--prod",
    "--legacy",
  ],
  { cwd: workspaceRoot, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    'import { execFileSync } from "node:child_process"; import { rgPath } from "@vscode/ripgrep"; execFileSync(rgPath, ["--version"], { stdio: "inherit", windowsHide: true });',
  ],
  { cwd: daemonRoot, stdio: "inherit" },
);
execFileSync(process.execPath, ["--import", "tsx", "scripts/build-native.ts"], {
  cwd: join(workspaceRoot, "packages", "computer-use"),
  stdio: "inherit",
});

mkdirSync(binariesRoot, { recursive: true });
for (const file of readdirSync(binariesRoot)) {
  if (file.startsWith("cwpi-node-") || file.startsWith("pi-computer-use-helper-")) {
    rmSync(join(binariesRoot, file));
  }
}
copyFileSync(process.execPath, sidecarPath);
copyFileSync(computerUseBinary, computerUseSidecarPath);

for (const requiredPath of [
  join(daemonRoot, "src", "bootstrap.ts"),
  join(daemonRoot, "node_modules", "tsx"),
  join(workspaceRoot, "apps", "web", "dist", "index.html"),
  computerUseSidecarPath,
  sidecarPath,
]) {
  if (!existsSync(requiredPath))
    throw new Error(`Desktop bundle input is missing: ${requiredPath}`);
}
