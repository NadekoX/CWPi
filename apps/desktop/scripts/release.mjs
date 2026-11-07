import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("CWPi 的 NSIS 安装包必须在 Windows x64 上构建");
}
if (Number(process.versions.node.split(".")[0]) < 24) {
  throw new Error("桌面打包需要 Node.js 24 或更高版本");
}

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请通过 pnpm build:desktop 或 pnpm release:desktop 执行");

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const desktopPackage = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
const tauriConfig = JSON.parse(
  await readFile(join(desktopRoot, "src-tauri", "tauri.conf.json"), "utf8"),
);
const target = "x86_64-pc-windows-msvc";
const installerName = `${tauriConfig.productName}_${desktopPackage.version}_x64-setup.exe`;
const installer = join(
  desktopRoot,
  "src-tauri",
  "target",
  target,
  "release",
  "bundle",
  "nsis",
  installerName,
);
const buildStartedAt = Date.now();

execFileSync(
  process.execPath,
  [
    pnpm,
    "exec",
    "tauri",
    "build",
    "--config",
    "src-tauri/tauri.bundle.conf.json",
    "--target",
    target,
  ],
  { cwd: desktopRoot, stdio: "inherit" },
);

const artifact = await stat(installer);
if (!artifact.isFile() || !artifact.size || artifact.mtimeMs < buildStartedAt) {
  throw new Error("Tauri 未生成本次构建的 NSIS 安装程序");
}

if (process.argv.includes("--release")) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  await writeFile(`${installer}.sha256`, `${hash.digest("hex")}  ${basename(installer)}\n`);
}

console.log(`Windows 11 x64 安装包：${installer}`);
