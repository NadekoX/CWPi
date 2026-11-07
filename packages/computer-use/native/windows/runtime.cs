using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows.Automation;

namespace CWPi.ComputerUse
{
    internal sealed class Snapshot
    {
        internal IntPtr Window;
        internal IntPtr FocusedWindow;
        internal int Pid;
        internal long Start;
        internal long Time;
        internal string App;
        internal string Id;
        internal NativeRect Frame;
        internal readonly Stopwatch Age = Stopwatch.StartNew();
        internal readonly List<AutomationElement> Elements = new List<AutomationElement>();
        internal readonly List<System.Windows.Rect> ElementBounds = new List<System.Windows.Rect>();
    }

    internal static class Runtime
    {
        private static readonly Overlay Cursor = new Overlay();
        private const int MaxScopes = 128;
        private const long MaxObservationAgeMs = 120000;
        private static readonly Dictionary<string, Snapshot> Scopes = new Dictionary<string, Snapshot>();

        internal static object Observe(Dictionary<string, object> args)
        {
            Applications.Desktop();
            string scope = Protocol.Text(args, "scopeId", 200);
            int depth = Protocol.Number(args, "maxDepth", 1, 50, 20);
            int nodes = Protocol.Number(args, "maxNodes", 1, 5000, 1000);
            object screenshot = Protocol.Get(args, "includeScreenshot", true);
            if (!(screenshot is bool)) throw new Failure("INVALID_REQUEST", "Invalid includeScreenshot");

            // A failed refresh must not leave an older observation available for replay.
            Scopes.Remove(scope);
            var window = Applications.Resolve(Protocol.Get(args, "app") == null ? null : Protocol.Text(args, "app"));
            var state = new Snapshot
            {
                Window = window,
                Frame = Applications.Frame(window),
                Id = Guid.NewGuid().ToString("N"),
                Time = Protocol.Now()
            };
            string name;
            using (var process = Applications.Target(window))
            {
                state.Pid = process.Id;
                state.Start = process.StartTime.ToFileTimeUtc();
                state.App = Applications.AppId(process);
                name = process.ProcessName;
            }
            Applications.Verify(state);
            state.FocusedWindow = Applications.FocusedWindow(state);
            bool truncated;
            string tree = Accessibility.Observe(state, depth, nodes, out truncated);
            var result = Protocol.Obj(
                "accessibilityTree", tree,
                "application", Protocol.Obj("bundleId", state.App, "name", name, "pid", state.Pid),
                "observationId", state.Id, "observedAt", state.Time,
                "truncated", truncated, "windowId", window.ToInt64(), "windowTitle", Applications.Title(window));
            if ((bool)screenshot) Screenshot.Capture(state, result);
            Applications.Verify(state);
            if (Scopes.Count >= MaxScopes)
                Scopes.Remove(Scopes.OrderBy(pair => pair.Value.Time).First().Key);
            Cursor.ShowObservation(state);
            Scopes[scope] = state;
            return result;
        }

        internal static object Act(Dictionary<string, object> args)
        {
            string scope = Protocol.Text(args, "scopeId", 200);
            string id = Protocol.Text(args, "observationId", 200);
            Snapshot state;
            if (!Scopes.TryGetValue(scope, out state) || state.Id != id || state.Age.ElapsedMilliseconds > MaxObservationAgeMs)
                throw new Failure("OBSERVATION_EXPIRED", "Observe again before acting");
            if (Protocol.Get(args, "app") != null && !String.Equals(Protocol.Text(args, "app"), state.App, StringComparison.OrdinalIgnoreCase))
                throw new Failure("TARGET_CHANGED", "App does not match observation");

            // Consume before dispatch so a partially completed action cannot be replayed.
            Scopes.Remove(scope);
            Applications.Verify(state);
            var action = Protocol.Map(Protocol.Get(args, "action"));
            string kind = Protocol.Text(action, "kind", 32);
            string inputMethod;
            try
            {
                Cursor.ShowAction(state, action, kind);
                if (kind == "press" || kind == "perform_action" || kind == "set_value")
                {
                    Accessibility.PerformAction(state, action, kind);
                    inputMethod = ComputerInputMethod.UIA;
                }
                else
                    inputMethod = Input.PerformAction(state, action, kind);
                RequestContext.CheckDeadline();
            }
            catch
            {
                Cursor.Dispose();
                throw;
            }
            return Protocol.Obj("observationId", id, "performedAt", Protocol.Now(), "inputMethod", inputMethod);
        }

        internal static void Close()
        {
            Cursor.Dispose();
        }

        internal static object Dispatch(string method, Dictionary<string, object> args)
        {
            switch (method)
            {
                case "ping": return Protocol.Obj("protocolVersion", 1);
                case "get_permissions": return Permissions.GetPermissions();
                case "list_apps": return Applications.ListApps();
                case "observe": return Observe(args);
                case "act": return Act(args);
                default: throw new Failure("METHOD_NOT_FOUND", "Unknown helper method");
            }
        }
    }
}
