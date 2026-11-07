import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalPolicy } from "../src/approval-policy.js";
import {
  isPersistableCommandPrefixRule,
  readApplicableCommandPrefix,
} from "../src/command-policy.js";
import { evaluateToolCall, ToolPermission, ToolPolicyDecision } from "../src/tool-policy.js";

test("shell launchers cannot be saved as command prefixes", () => {
  for (const executable of ["cmd", "cmd.exe", "PoWeRsHeLl.ExE", "pwsh.exe", "wsl.exe"]) {
    const prefix = [executable, "/c"];
    assert.equal(isPersistableCommandPrefixRule(prefix), false, executable);
    assert.equal(readApplicableCommandPrefix(`${executable} /c echo test`, prefix), null);
  }
});

test("previously persisted shell rules cannot grant a new command", async () => {
  const request = {
    approvalPolicy: ApprovalPolicy.REQUEST_APPROVAL,
    policy: { permission: ToolPermission.SHELL },
    workspaceRoot: import.meta.dirname,
  } as const;

  const unsafe = await evaluateToolCall({
    ...request,
    allowedCommandPrefixes: [["cmd.exe", "/c"]],
    arguments: { command: "cmd.exe /c echo test" },
  });
  assert.equal(unsafe.decision, ToolPolicyDecision.ASK);

  const safe = await evaluateToolCall({
    ...request,
    allowedCommandPrefixes: [["git.exe", "status"]],
    arguments: { command: "git.exe status --short" },
  });
  assert.equal(safe.decision, ToolPolicyDecision.ALLOW);
});

test("Windows shell expansion and attached switches cannot be saved", {
  skip: process.platform !== "win32",
}, () => {
  for (const prefix of [
    ["cmd/c", "echo"],
    ["cmd,/c", "echo"],
    ["C:cmd.exe", "/c"],
    ["@cmd.exe", "/c"],
    ["git.exe", "status", "%CWPI_TEST%"],
    ["git.exe", "status", "^test"],
  ]) {
    assert.equal(isPersistableCommandPrefixRule(prefix), false, prefix.join(" "));
  }
});
