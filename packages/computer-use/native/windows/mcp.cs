using System;
using System.Collections.Generic;
using System.IO;

namespace CWPi.ComputerUse
{
    internal static class Mcp
    {
        private const string ScopeId = "mcp";

        internal static object Handle(Dictionary<string, object> request)
        {
            object id = Protocol.Get(request, "id");
            if (id == null) return null;
            if (Protocol.Get(request, "jsonrpc") as string != "2.0")
                return Error(id, -32600, "Invalid JSON-RPC request");
            string method = Protocol.Text(request, "method");
            var args = Protocol.Map(Protocol.Get(request, "params", Protocol.Obj()));
            object result;
            switch (method)
            {
                case "initialize":
                    result = Protocol.Obj(
                        "protocolVersion", Protocol.Text(args, "protocolVersion"),
                        "capabilities", Protocol.Obj("tools", Protocol.Obj("listChanged", false)),
                        "serverInfo", Protocol.Obj("name", "computer-use", "version", "0.1.0"),
                        "instructions", "Windows: list apps to obtain a windows.* app ID. Observe before every action. Observation, UIA element actions, matching left clicks and scrolling can run in the background. Standard Unicode editors support scoped background text editing. Other real keyboard and pointer input requires the foreground target. Results report inputMethod; verify outcomes by observing again. Coordinates are physical screen pixels; command maps to Windows and option to Alt. Global shortcuts are rejected.");
                    break;
                case "ping": result = Protocol.Obj(); break;
                case "tools/list": result = ListTools(); break;
                case "tools/call": result = CallTool(args); break;
                default: return Error(id, -32601, "Method not found");
            }
            return Protocol.Obj("jsonrpc", "2.0", "id", id, "result", result);
        }

        private static object ListTools()
        {
            using (var stream = typeof(Program).Assembly.GetManifestResourceStream("computer-use-tools.json"))
            using (var reader = new StreamReader(stream))
                return Protocol.Obj("tools", Protocol.Json.DeserializeObject(reader.ReadToEnd()));
        }

        private static object CallTool(Dictionary<string, object> args)
        {
            try
            {
                string name = Protocol.Text(args, "name");
                var arguments = Protocol.Map(Protocol.Get(args, "arguments", Protocol.Obj()));
                arguments["scopeId"] = ScopeId;
                object value;
                switch (name)
                {
                    case "computer_list_apps": value = Applications.ListApps(); break;
                    case "computer_observe": value = Runtime.Observe(arguments); break;
                    case "computer_act":
                        Protocol.Text(arguments, "app");
                        value = Runtime.Act(arguments);
                        break;
                    default: throw new Failure("METHOD_NOT_FOUND", "Unknown tool");
                }
                var content = new List<object>();
                var observation = value as Dictionary<string, object>;
                if (observation != null && observation.ContainsKey("screenshot"))
                {
                    content.Add(observation["screenshot"]);
                    observation.Remove("screenshot");
                }
                content.Add(Protocol.Obj("type", "text", "text", Protocol.Json.Serialize(value)));
                return Protocol.Obj("content", content);
            }
            catch (Exception error)
            {
                return Protocol.Obj("isError", true, "content", new object[]
                {
                    Protocol.Obj("type", "text", "text", Protocol.SafeError(error))
                });
            }
        }

        internal static object Error(object id, int code, string message)
        {
            return Protocol.Obj("jsonrpc", "2.0", "id", id, "error", Protocol.Obj("code", code, "message", message));
        }
    }
}
