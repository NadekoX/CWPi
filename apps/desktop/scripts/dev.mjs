import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请通过 pnpm dev:desktop 执行");
const children = [];

async function isReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

function start(packageName) {
  const child = spawn(
    process.execPath,
    [pnpm, "--dir", workspaceRoot, "--filter", packageName, "dev"],
    {
      stdio: "inherit",
    },
  );
  children.push(child);
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    if (code) process.exitCode = code;
  });
}

if (!(await isReachable("http://127.0.0.1:4310/api/health"))) {
  start("@cwpi/daemon");
}
if (!(await isReachable("http://127.0.0.1:5173"))) {
  start("@cwpi/web");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
