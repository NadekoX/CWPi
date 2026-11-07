using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

namespace CWPi.ComputerUse
{
    internal sealed class Overlay : IDisposable
    {
        private Process child;
        private IntPtr lastWindow;
        private NativePoint? lastPoint;

        internal void ShowObservation(Snapshot state)
        {
            Update(state, lastWindow == state.Window ? lastPoint : null);
        }

        internal void ShowAction(Snapshot state, Dictionary<string, object> action, string kind)
        {
            NativePoint? point;
            switch (kind)
            {
                case "press":
                case "perform_action":
                case "set_value": point = Accessibility.ActionPoint(state, action); break;
                case "click":
                case "scroll": point = Input.ResolvePoint(state, Protocol.Get(action, "point"), false); break;
                case "drag": point = Input.ResolvePoint(state, Protocol.Get(action, "to"), false); break;
                case "press_key":
                case "type_text": point = lastWindow == state.Window ? lastPoint : null; break;
                default: return;
            }
            Update(state, point);
            lastWindow = state.Window;
            lastPoint = point;
        }

        private void Update(Snapshot state, NativePoint? point)
        {
            if (child == null && !point.HasValue) return;
            RequestContext.CheckDeadline();
            try
            {
                EnsureProcess();
                if (child.HasExited) throw new Failure("OVERLAY_UNAVAILABLE", "AI cursor overlay exited");
                var frame = state.Frame;
                object position = point.HasValue ? Protocol.Obj("x", point.Value.X, "y", point.Value.Y) : null;
                uint dpi = NativeMethods.GetDpiForWindow(state.Window);
                child.StandardInput.WriteLine(Protocol.Json.Serialize(Protocol.Obj(
                    "frame", Protocol.Obj("x", frame.Left, "y", frame.Top, "width", frame.Right - frame.Left, "height", frame.Bottom - frame.Top),
                    "point", position, "dpi", dpi == 0 ? 96u : dpi)));
                child.StandardInput.Flush();
                ReadAcknowledgement();
            }
            catch (Exception error)
            {
                Dispose();
                if (error is Failure) throw;
                throw new Failure("OVERLAY_UNAVAILABLE", "Cannot update the AI cursor overlay");
            }
            RequestContext.CheckDeadline();
        }

        private void EnsureProcess()
        {
            if (child != null) return;
            // The fixed current helper also hosts a display-only mode; model input never selects an executable.
            var start = new ProcessStartInfo
            {
                FileName = Assembly.GetExecutingAssembly().Location,
                Arguments = "--overlay",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false)
            };
            child = Process.Start(start);
            if (child == null) throw new Failure("OVERLAY_UNAVAILABLE", "Cannot start the AI cursor overlay");
            child.BeginErrorReadLine();
            ReadAcknowledgement();
        }

        private void ReadAcknowledgement()
        {
            var response = child.StandardOutput.ReadLineAsync();
            if (!response.Wait(2000) || response.Result == null)
                throw new Failure("OVERLAY_UNAVAILABLE", "AI cursor overlay did not respond");
            var result = Protocol.Map(Protocol.Json.DeserializeObject(response.Result));
            if (!Object.Equals(Protocol.Get(result, "ok"), true))
                throw new Failure("OVERLAY_UNAVAILABLE", "AI cursor overlay could not display the action");
        }

        public void Dispose()
        {
            var process = child;
            child = null;
            lastPoint = null;
            lastWindow = IntPtr.Zero;
            if (process == null) return;
            try
            {
                try { process.StandardInput.Close(); }
                catch (IOException) { Console.Error.WriteLine("AI cursor overlay input pipe was already closed"); }
                if (!process.WaitForExit(500))
                {
                    process.Kill();
                    if (!process.WaitForExit(500)) Console.Error.WriteLine("AI cursor overlay termination is still pending");
                }
            }
            catch (InvalidOperationException) { Console.Error.WriteLine("AI cursor overlay process already exited"); }
            catch (System.ComponentModel.Win32Exception) { Console.Error.WriteLine("Could not terminate the AI cursor overlay process"); }
            finally { process.Dispose(); }
        }
    }
}
