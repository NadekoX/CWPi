using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace CWPi.ComputerUse
{
    internal static class Applications
    {
        private static readonly HashSet<string> Protected = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "CWPi", "cwpi-desktop", "pi-computer-use-helper", "WindowsTerminal", "WindowsTerminalPreview",
            "cmd", "powershell", "pwsh", "conhost", "OpenConsole", "mintty", "wsl", "bash", "wt",
            "consent", "CredentialUIBroker", "LogonUI", "winlogon", "Taskmgr"
        };

        internal static void Desktop()
        {
            var desktop = NativeMethods.OpenInputDesktop(0, false, 0x0100 | 0x0001);
            if (desktop == IntPtr.Zero)
                throw new Failure("DESKTOP_UNAVAILABLE", "An unlocked interactive Windows desktop is required");
            NativeMethods.CloseDesktop(desktop);
        }

        internal static string Title(IntPtr window)
        {
            var text = new StringBuilder(2001);
            NativeMethods.GetWindowText(window, text, text.Capacity);
            return text.ToString();
        }

        internal static Process Target(IntPtr window)
        {
            int pid;
            NativeMethods.GetWindowThreadProcessId(window, out pid);
            var process = Process.GetProcessById(pid);
            string title = Title(window);
            if (Protected.Contains(process.ProcessName) ||
                String.Equals(title, "CWPi", StringComparison.OrdinalIgnoreCase) ||
                title.StartsWith("CWPi - ", StringComparison.OrdinalIgnoreCase) ||
                title.StartsWith("CWPi — ", StringComparison.OrdinalIgnoreCase))
            {
                process.Dispose();
                throw new Failure("APP_PROTECTED", "Cannot access CWPi, terminals, or system security applications");
            }
            return process;
        }

        internal static string AppId(Process process)
        {
            // Keep existing persisted grants valid: identity is derived from the executable path.
            using (var hash = SHA256.Create())
                return "windows." + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(process.MainModule.FileName.ToUpperInvariant())))
                    .Replace("-", "").ToLowerInvariant();
        }

        private static List<IntPtr> Windows()
        {
            var result = new List<IntPtr>();
            NativeMethods.EnumWindows(delegate(IntPtr window, IntPtr unused)
            {
                if (NativeMethods.IsWindowVisible(window) && Title(window).Length > 0) result.Add(window);
                return result.Count < 1000;
            }, IntPtr.Zero);
            return result;
        }

        internal static object ListApps()
        {
            Desktop();
            var apps = new Dictionary<string, object>();
            foreach (var window in Windows())
            {
                RequestContext.CheckDeadline();
                try
                {
                    using (var process = Target(window))
                    {
                        string id = AppId(process);
                        apps[id] = Protocol.Obj("bundleId", id, "name", process.ProcessName, "pid", process.Id, "isRunning", true);
                    }
                }
                catch (Exception error) { if (!Unavailable(error)) throw; }
            }
            return apps.Values.ToArray();
        }

        private static bool Unavailable(Exception error)
        {
            // Enumeration can race process exit or encounter protected/inaccessible applications.
            return (error is Failure && ((Failure)error).Code == "APP_PROTECTED") || error is Win32Exception ||
                error is InvalidOperationException || error is ArgumentException;
        }

        internal static IntPtr Resolve(string app)
        {
            if (app == null) return NativeMethods.GetForegroundWindow();
            var matches = new List<IntPtr>();
            foreach (var window in Windows())
            {
                RequestContext.CheckDeadline();
                try
                {
                    using (var process = Target(window))
                    {
                        if (String.Equals(AppId(process), app, StringComparison.OrdinalIgnoreCase) ||
                            String.Equals(process.ProcessName, app, StringComparison.OrdinalIgnoreCase) ||
                            String.Equals(process.ProcessName + ".exe", app, StringComparison.OrdinalIgnoreCase))
                            matches.Add(window);
                    }
                }
                catch (Exception error) { if (!Unavailable(error)) throw; }
            }
            var foreground = NativeMethods.GetForegroundWindow();
            if (matches.Contains(foreground)) return foreground;
            if (matches.Count != 1)
                throw new Failure("APP_NOT_FOUND", "No unique target window; open the application and select its window first");
            return matches[0];
        }

        internal static NativeRect Frame(IntPtr window)
        {
            NativeRect frame;
            if (window == IntPtr.Zero || NativeMethods.IsIconic(window) || !NativeMethods.IsWindowVisible(window) ||
                !NativeMethods.GetWindowRect(window, out frame))
                throw new Failure("WINDOW_UNAVAILABLE", "Target window must be visible and restored");
            if (frame.Right <= frame.Left || frame.Bottom <= frame.Top ||
                (long)(frame.Right - frame.Left) * (frame.Bottom - frame.Top) > 32000000)
                throw new Failure("WINDOW_UNAVAILABLE", "Window size is invalid or exceeds capture limits");
            return frame;
        }

        internal static IntPtr FocusedWindow(Snapshot state)
        {
            int pid;
            uint thread = NativeMethods.GetWindowThreadProcessId(state.Window, out pid);
            var info = new GuiThreadInfo { Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
            if (thread == 0 || pid != state.Pid || !NativeMethods.GetGUIThreadInfo(thread, ref info) || info.Focus == IntPtr.Zero)
                return IntPtr.Zero;
            NativeMethods.GetWindowThreadProcessId(info.Focus, out pid);
            return pid == state.Pid && NativeMethods.GetAncestor(info.Focus, 2) == state.Window ? info.Focus : IntPtr.Zero;
        }

        internal static void Verify(Snapshot state, bool requireForeground = false)
        {
            RequestContext.CheckDeadline();
            Desktop();
            using (var process = Target(state.Window))
            {
                if (process.Id != state.Pid || process.StartTime.ToFileTimeUtc() != state.Start || AppId(process) != state.App)
                    throw new Failure("TARGET_CHANGED", "Target process changed; observe again");
            }
            var frame = Frame(state.Window);
            var observed = state.Frame;
            if (frame.Left != observed.Left || frame.Top != observed.Top || frame.Right != observed.Right || frame.Bottom != observed.Bottom)
                throw new Failure("TARGET_CHANGED", "Target window moved or resized; observe again");
            // UIA and PrintWindow address the target HWND directly; SendInput addresses the foreground desktop.
            if (requireForeground && NativeMethods.GetForegroundWindow() != state.Window)
                throw new Failure("TARGET_NOT_FOREGROUND", "Select the observed target window before keyboard or pointer input, then observe again");
        }
    }
}
