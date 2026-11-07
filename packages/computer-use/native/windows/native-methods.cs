using System;
using System.Runtime.InteropServices;
using System.Text;

namespace CWPi.ComputerUse
{
    [StructLayout(LayoutKind.Sequential)] internal struct NativeRect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct NativePoint { internal int X, Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct MouseInput { internal int dx, dy; internal uint data, flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct KeyboardInput { internal ushort vk, scan; internal uint flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] internal MouseInput mouse; [FieldOffset(0)] internal KeyboardInput key; }
    [StructLayout(LayoutKind.Sequential)] internal struct NativeInput { internal uint type; internal InputUnion data; }
    [StructLayout(LayoutKind.Sequential)] internal struct NativeSize { internal int Width, Height; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] internal struct BlendFunction
    {
        internal byte Operation, Flags, Alpha, Format;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct GuiThreadInfo
    {
        internal uint Size, Flags;
        internal IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        internal NativeRect CaretRect;
    }
    internal delegate bool EnumWindowCallback(IntPtr window, IntPtr data);

    internal static class NativeMethods
    {
        [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumWindowCallback callback, IntPtr data);
        [DllImport("user32.dll")] internal static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int length);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] internal static extern int GetWindowStyle(IntPtr window, int index);
        [DllImport("user32.dll")] internal static extern bool IsWindowUnicode(IntPtr window);
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr SendWindowText(IntPtr window, uint message, IntPtr parameter, string text, uint flags, uint timeout, out UIntPtr result);
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
        internal static extern IntPtr SendWindowMessage(IntPtr window, uint message, IntPtr parameter, IntPtr value, uint flags, uint timeout, out UIntPtr result);
        [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(NativePoint point);
        [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll")] internal static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] internal static extern uint SendInput(uint count, NativeInput[] inputs, int size);
        [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] internal static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] internal static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr window);
        [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr window, IntPtr dc);
        [DllImport("gdi32.dll")] internal static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] internal static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] internal static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
        [DllImport("gdi32.dll")] internal static extern bool DeleteObject(IntPtr value);
        [DllImport("user32.dll")] internal static extern bool UpdateLayeredWindow(
            IntPtr window, IntPtr destinationDc, ref NativePoint position, ref NativeSize size,
            IntPtr sourceDc, ref NativePoint source, uint colorKey, ref BlendFunction blend, uint flags);
        [DllImport("user32.dll")] internal static extern bool SystemParametersInfo(
            uint action, uint parameter, [MarshalAs(UnmanagedType.Bool)] out bool value, uint flags);
        [DllImport("user32.dll")] internal static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    }
}
