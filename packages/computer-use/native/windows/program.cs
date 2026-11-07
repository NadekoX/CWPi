using System;

namespace CWPi.ComputerUse
{
    internal static class Program
    {
        [MTAThread]
        private static int Main(string[] arguments)
        {
            if (arguments.Length > 1 || (arguments.Length == 1 && (arguments[0] != "--mcp" && arguments[0] != "--overlay"))) return 1;
            // UIA stays on this MTA thread; only pipe reading runs concurrently.
            if (!NativeMethods.SetProcessDpiAwarenessContext(new IntPtr(-4)))
            {
                Console.Error.WriteLine("Cannot enable physical-pixel coordinates");
                return 1;
            }
            if (arguments.Length == 1 && arguments[0] == "--overlay") return OverlayWindow.Run();
            try { return Transport.Run(arguments.Length == 1); }
            finally { Runtime.Close(); }
        }
    }
}
