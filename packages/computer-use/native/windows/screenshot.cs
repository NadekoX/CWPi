using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace CWPi.ComputerUse
{
    internal static class Screenshot
    {
        internal static void Capture(Snapshot state, Dictionary<string, object> result)
        {
            RequestContext.CheckDeadline();
            int width = state.Frame.Right - state.Frame.Left;
            int height = state.Frame.Bottom - state.Frame.Top;
            using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                IntPtr dc = graphics.GetHdc();
                bool captured;
                // Capture only this HWND; a desktop-copy fallback could expose unrelated windows.
                try { captured = NativeMethods.PrintWindow(state.Window, dc, 2); }
                finally { graphics.ReleaseHdc(dc); }
                RequestContext.CheckDeadline();
                if (!captured) throw new Failure("CAPTURE_FAILED", "Application does not support window capture; observe without a screenshot to use UI Automation");
                double scale = Math.Min(1, Math.Min(1920.0 / width, 1200.0 / height));
                using (var resized = new Bitmap(bitmap, Math.Max(1, (int)(width * scale)), Math.Max(1, (int)(height * scale))))
                using (var bytes = new MemoryStream())
                {
                    resized.Save(bytes, ImageFormat.Png);
                    if (bytes.Length > 14000000) throw new Failure("CAPTURE_FAILED", "Image exceeds response limit");
                    result["screenshot"] = Protocol.Obj("data", Convert.ToBase64String(bytes.ToArray()), "mimeType", "image/png", "type", "image");
                    result["screenshotFrame"] = Protocol.Obj("x", state.Frame.Left, "y", state.Frame.Top, "width", width, "height", height, "scale", scale);
                }
            }
            RequestContext.CheckDeadline();
        }
    }
}
