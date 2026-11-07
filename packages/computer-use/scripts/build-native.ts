import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { ComputerActionSchema } from "../src/protocol.js";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Computer Use helper 仅支持 Windows 11 x64 构建");
}

const root = fileURLToPath(new URL("../", import.meta.url));
const framework = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
);
const compiler = join(framework, "csc.exe");
if (!existsSync(compiler)) throw new Error("Windows helper 构建需要 .NET Framework 4.8 编译器");
const output = join(root, "native/target/release");
mkdirSync(output, { recursive: true });
const app = Type.String({ minLength: 1, maxLength: 500 });
const schemaPath = join(output, "computer-use-tools.json");
// Generate the native MCP action schema from the same contract as the TS client.
writeFileSync(
  schemaPath,
  JSON.stringify([
    {
      name: "computer_list_apps",
      description: "List running Windows apps and their stable windows.* app IDs.",
      inputSchema: Type.Object({}, { additionalProperties: false }),
    },
    {
      name: "computer_observe",
      description:
        "Observe a running Windows app without activating it. Returns its UI Automation tree and window PNG when supported. Observe again after every action.",
      inputSchema: Type.Object(
        {
          app: Type.Optional(app),
          appName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          includeScreenshot: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    },
    {
      name: "computer_act",
      description:
        "Control the observed Windows app with its exact windows.* app ID and latest observationId. Prefer background UI Automation element actions; left clicks and scrolling use matching UIA controls when supported. Standard Unicode editors support scoped background text editing. Other real keyboard and pointer input requires the foreground target. Results report inputMethod; observe after each action. Coordinates are physical screen pixels; option means Alt, control means Ctrl. Global system shortcuts are rejected.",
      inputSchema: Type.Object(
        {
          action: ComputerActionSchema,
          app,
          observationId: Type.String({ minLength: 1, maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
    },
  ]),
);
execFileSync(
  compiler,
  [
    "/nologo",
    "/optimize+",
    "/target:exe",
    "/platform:x64",
    `/out:${join(output, "pi-computer-use-helper.exe")}`,
    `/resource:${schemaPath},computer-use-tools.json`,
    `/reference:${join(framework, "System.Web.Extensions.dll")}`,
    `/reference:${join(framework, "System.Drawing.dll")}`,
    `/reference:${join(framework, "System.Windows.Forms.dll")}`,
    ...["UIAutomationClient.dll", "UIAutomationTypes.dll", "WindowsBase.dll"].map(
      (assembly) => `/reference:${join(framework, "WPF", assembly)}`,
    ),
    ...readdirSync(join(root, "native/windows"))
      .filter((file) => file.endsWith(".cs"))
      .sort()
      .map((file) => join(root, "native/windows", file)),
  ],
  { stdio: "inherit" },
);
