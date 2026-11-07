using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace CWPi.ComputerUse
{
    internal sealed class OverlayWindow : Form
    {
        private const int CursorSize = 28;
        private const int HotspotOffset = 6;
        private const int HideAfterMs = 12000;
        private const uint GetClientAreaAnimation = 0x1042;
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        private readonly Stopwatch sinceUpdate = new Stopwatch();
        private readonly Stopwatch sinceMove = new Stopwatch();
        private NativePoint? point;
        private double scale = 1;
        private bool animate;

        private OverlayWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(1, 1);
            ShowInTaskbar = false;
            TopMost = true;
            Enabled = false;
            timer.Tick += Tick;
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                // LAYERED + TRANSPARENT forwards mouse input; NOACTIVATE keeps the user's focus.
                parameters.ExStyle |= 0x00080000 | 0x00000020 | 0x08000000 | 0x00000080;
                return parameters;
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; }
            if (message.Msg == 0x0084) { message.Result = new IntPtr(-1); return; }
            if (message.Msg == 0x001A) UpdateAnimationSettings();
            base.WndProc(ref message);
        }

        internal static int Run()
        {
            // The helper's UIA thread stays MTA; the separate renderer owns its own STA message loop.
            Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
            int result = 0;
            var ui = new Thread(() =>
            {
                try
                {
                    Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
                    using (var window = new OverlayWindow())
                    {
                        var handle = window.Handle;
                        Acknowledge(true);
                        var reader = new Thread(() => window.ReadUpdates()) { IsBackground = true };
                        reader.Start();
                        Application.Run();
                    }
                }
                catch (Exception) { result = 1; Console.Error.WriteLine("AI cursor overlay failed"); }
            });
            ui.SetApartmentState(ApartmentState.STA);
            ui.Start();
            ui.Join();
            return result;
        }

        private void ReadUpdates()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (line.Length > 4096) break;
                    var update = Protocol.Map(Protocol.Json.DeserializeObject(line));
                    BeginInvoke(new Action(() =>
                    {
                        try { ApplyUpdate(update); Acknowledge(true); }
                        catch (Exception) { HideCursor(); Acknowledge(false); }
                    }));
                }
            }
            catch (Exception) { Console.Error.WriteLine("AI cursor overlay update pipe closed"); }
            finally
            {
                try { BeginInvoke(new Action(() => { HideCursor(); Close(); Application.ExitThread(); })); }
                catch (InvalidOperationException) { Console.Error.WriteLine("AI cursor overlay window already closed"); }
            }
        }

        private static void Acknowledge(bool ok)
        {
            Console.WriteLine(Protocol.Json.Serialize(Protocol.Obj("ok", ok)));
        }

        private void ApplyUpdate(Dictionary<string, object> update)
        {
            object position = Protocol.Get(update, "point");
            if (position == null) { HideCursor(); return; }
            var frame = Protocol.Map(Protocol.Get(update, "frame"));
            int x = Protocol.Number(frame, "x", -100000, 100000);
            int y = Protocol.Number(frame, "y", -100000, 100000);
            int width = Protocol.Number(frame, "width", 1, 100000);
            int height = Protocol.Number(frame, "height", 1, 100000);
            var coordinates = Protocol.Map(position);
            var next = new NativePoint
            {
                X = Protocol.Number(coordinates, "x", -100000, 100000),
                Y = Protocol.Number(coordinates, "y", -100000, 100000)
            };
            if (next.X < x || next.X >= x + width || next.Y < y || next.Y >= y + height)
            {
                HideCursor();
                return;
            }
            if (!point.HasValue || point.Value.X != next.X || point.Value.Y != next.Y) sinceMove.Restart();
            point = next;
            scale = Protocol.Number(update, "dpi", 48, 768) / 96.0;
            UpdateAnimationSettings();
            sinceUpdate.Restart();
            if (!Visible) Show();
            Render();
            timer.Start();
        }

        private void UpdateAnimationSettings()
        {
            bool animations;
            animate = NativeMethods.SystemParametersInfo(GetClientAreaAnimation, 0, out animations, 0) && animations;
            timer.Interval = animate ? 33 : 200;
        }

        private void Tick(object sender, EventArgs args)
        {
            try
            {
                if (sinceUpdate.ElapsedMilliseconds >= HideAfterMs) HideCursor();
                else if (animate) Render();
            }
            catch (Exception) { HideCursor(); Console.Error.WriteLine("AI cursor overlay rendering failed"); }
        }

        private void HideCursor()
        {
            timer.Stop();
            Hide();
            point = null;
        }

        private void Render()
        {
            if (!point.HasValue) return;
            int pixels = Math.Max(1, (int)Math.Round(CursorSize * scale));
            using (var bitmap = new Bitmap(pixels, pixels, PixelFormat.Format32bppPArgb))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.ScaleTransform((float)scale, (float)scale);
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                float breath = animate ? (float)(0.85 + 0.15 * Math.Sin(sinceMove.Elapsed.TotalSeconds * Math.PI / 2.2)) : 1;
                using (var path = new GraphicsPath())
                {
                    path.AddEllipse(0, 0, CursorSize, CursorSize);
                    using (var glow = new PathGradientBrush(path))
                    {
                        glow.CenterColor = Color.FromArgb((int)(100 * breath), 4, 133, 247);
                        glow.SurroundColors = new Color[] { Color.FromArgb(0, 4, 133, 247) };
                        graphics.FillPath(glow, path);
                    }
                }
                // Cursor.DrawStretched uses a native DC, so supply physical pixels rather than GDI+ transforms.
                graphics.ResetTransform();
                double sway = animate && sinceMove.ElapsedMilliseconds > 700
                    ? Math.Sin(sinceMove.Elapsed.TotalSeconds * Math.PI / 1.4) : 0;
                int offset = (int)Math.Round(HotspotOffset * scale);
                int pointerSize = Math.Max(1, (int)Math.Round(16 * scale));
                Cursors.Arrow.DrawStretched(graphics, new Rectangle(offset + (int)Math.Round(sway * scale), offset, pointerSize, pointerSize));
                Present(bitmap, pixels);
            }
        }

        private void Present(Bitmap bitmap, int pixels)
        {
            IntPtr screen = NativeMethods.GetDC(IntPtr.Zero);
            IntPtr memory = IntPtr.Zero;
            IntPtr image = IntPtr.Zero;
            IntPtr previous = IntPtr.Zero;
            try
            {
                if (screen == IntPtr.Zero) throw new InvalidOperationException("Cannot acquire display context");
                memory = NativeMethods.CreateCompatibleDC(screen);
                if (memory == IntPtr.Zero) throw new InvalidOperationException("Cannot acquire bitmap context");
                image = bitmap.GetHbitmap(Color.FromArgb(0));
                previous = NativeMethods.SelectObject(memory, image);
                if (previous == IntPtr.Zero || previous == new IntPtr(-1)) throw new InvalidOperationException("Cannot select cursor bitmap");
                var position = new NativePoint
                {
                    X = point.Value.X - (int)Math.Round(HotspotOffset * scale),
                    Y = point.Value.Y - (int)Math.Round(HotspotOffset * scale)
                };
                var size = new NativeSize { Width = pixels, Height = pixels };
                var source = new NativePoint();
                var blend = new BlendFunction { Alpha = 255, Format = 1 };
                if (!NativeMethods.UpdateLayeredWindow(Handle, screen, ref position, ref size, memory, ref source, 0, ref blend, 2))
                    throw new InvalidOperationException("Cannot present cursor bitmap");
            }
            finally
            {
                if (previous != IntPtr.Zero && previous != new IntPtr(-1)) NativeMethods.SelectObject(memory, previous);
                if (image != IntPtr.Zero) NativeMethods.DeleteObject(image);
                if (memory != IntPtr.Zero) NativeMethods.DeleteDC(memory);
                if (screen != IntPtr.Zero) NativeMethods.ReleaseDC(IntPtr.Zero, screen);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) timer.Dispose();
            base.Dispose(disposing);
        }
    }
}
