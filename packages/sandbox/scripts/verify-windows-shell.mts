import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSandboxedShell } from "../src/process-sandbox.js";

if (process.platform !== "win32" || process.env.CWPI_EXPERIMENTAL_WINDOWS_SHELL !== "1") {
  throw new Error("Run on Windows with CWPI_EXPERIMENTAL_WINDOWS_SHELL=1 after provisioning SRT");
}

const workspaceRoot = await mkdtemp(join(process.cwd(), "CWPi shell test-"));
const otherWorkspace = await mkdtemp(join(process.cwd(), "CWPi other workspace-"));
const protectedRoot = await mkdtemp(join(tmpdir(), "CWPi shell protected-"));
const protectedFile = join(protectedRoot, "secret.txt");
const node = `"${process.execPath}"`;
let connections = 0;
const server = createServer((socket) => {
  connections++;
  socket.destroy();
});
const start = (command: string) =>
  spawnSandboxedShell({
    allowedDomains: [],
    command,
    commandId: randomUUID(),
    isWorkspaceWritable: false,
    protectedPaths: [protectedRoot],
    signal: AbortSignal.timeout(60_000),
    workspaceRoot,
  });

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await writeFile(protectedFile, "protected marker");
  const otherFile = join(otherWorkspace, "other.txt");
  await writeFile(otherFile, "other workspace marker");
  await writeFile(join(workspaceRoot, "allowed.txt"), "allowed marker");
  await writeFile(
    join(workspaceRoot, "probe.cjs"),
    `const { readFileSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const { connect } = require("node:net");
assert.equal(readFileSync("allowed.txt", "utf8"), "allowed marker");
assert.throws(() => readFileSync(${JSON.stringify(protectedFile)}, "utf8"));
assert.throws(() => readFileSync(${JSON.stringify(otherFile)}, "utf8"));
assert.throws(() => writeFileSync("allowed.txt", "unexpected write"));
const socket = connect(${address.port}, "127.0.0.1");
socket.setTimeout(3000, () => socket.destroy(new Error("blocked")));
socket.once("connect", () => { throw new Error("Sandbox reached a direct loopback socket"); });
socket.once("error", () => {
  console.log("file and network policy verified");
  process.exitCode = 7;
});
`,
  );
  const probe = await start(`${node} probe.cjs`);
  try {
    let output = "";
    for await (const chunk of probe.process.stdout) output += chunk.toString();
    const status = probe.process.exitCode ?? (await once(probe.process, "exit"))[0];
    assert.equal(status, 7);
    assert.match(output, /file and network policy verified/);
    assert.equal(connections, 0);
    assert.equal(await readFile(join(workspaceRoot, "allowed.txt"), "utf8"), "allowed marker");
  } finally {
    await probe.close();
  }

  await writeFile(
    join(workspaceRoot, "process-tree.cjs"),
    `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { windowsHide: true });
child.once("spawn", () => console.log("child=" + child.pid));
`,
  );
  const tree = await start(`${node} process-tree.cjs`);
  try {
    let output = "";
    const childPid = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("No child PID received")), 10_000);
      tree.process.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /child=(\d+)/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
    });
    await assert.rejects(start("echo busy"), /SANDBOX_WINDOWS_BUSY/);
    await tree.close();
    for (let attempt = 0; attempt < 10; attempt++) {
      const processes = execFileSync(
        "tasklist.exe",
        ["/FI", `PID eq ${childPid}`, "/FO", "CSV", "/NH"],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      );
      if (!processes.includes(`"${childPid}"`)) break;
      assert.notEqual(attempt, 9, "Sandbox grandchild survived close()");
      await delay(100);
    }
  } finally {
    await tree.close();
  }
  console.log(
    "Windows Shell sandbox verified: files, network, output, concurrency, process tree cleanup.",
  );
} finally {
  server.close();
  await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5 });
  await rm(otherWorkspace, { recursive: true, force: true, maxRetries: 5 });
  await rm(protectedRoot, { recursive: true, force: true, maxRetries: 5 });
}
