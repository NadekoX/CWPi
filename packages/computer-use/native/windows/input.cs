using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

namespace CWPi.ComputerUse
{
    internal static class Input
    {
        private static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            {"enter",13},{"return",13},{"tab",9},{"escape",27},{"esc",27},{"space",32},{"backspace",8},{"delete",46},
            {"left",37},{"arrowleft",37},{"up",38},{"arrowup",38},{"right",39},{"arrowright",39},{"down",40},{"arrowdown",40},
            {"home",36},{"end",35},{"pageup",33},{"pagedown",34}
        };

        internal static string PerformAction(Snapshot state, Dictionary<string, object> action, string kind)
        {
            Applications.Verify(state);
            if (kind == "click")
            {
                var point = ResolvePoint(state, Protocol.Get(action, "point"), false);
                string button = Protocol.Text(Protocol.Obj("button", Protocol.Get(action, "button", "left")), "button", 5);
                if (button == "left" && Accessibility.TryClick(state, point)) return ComputerInputMethod.UIA;
            }
            if (kind == "scroll")
            {
                var point = ResolvePoint(state, Protocol.Get(action, "point"), false);
                int dx = Protocol.Number(action, "deltaX", -10000, 10000);
                int dy = Protocol.Number(action, "deltaY", -10000, 10000);
                if (Accessibility.TryScroll(state, point, dx, dy)) return ComputerInputMethod.UIA;
            }
            if (NativeMethods.GetForegroundWindow() != state.Window && BackgroundInput.TryPerform(state, action, kind))
                return ComputerInputMethod.WINDOW_MESSAGE;
            // Unsupported background requests fail here; an attempted UIA/message action never falls back.
            Applications.Verify(state, true);
            switch (kind)
            {
                case "click": Click(state, action); break;
                case "scroll": Scroll(state, action); break;
                case "drag": Drag(state, action); break;
                case "type_text": TypeText(state, Protocol.Text(action, "text", 20000, true)); break;
                case "press_key": PressKey(state, action); break;
                default: throw new Failure("INVALID_REQUEST", "Unknown action kind");
            }
            return ComputerInputMethod.FOREGROUND_INPUT;
        }

        private static void Click(Snapshot state, Dictionary<string, object> action)
        {
            NoHeldModifiers();
            var point = ResolvePoint(state, Protocol.Get(action, "point"));
            string button = Protocol.Text(Protocol.Obj("button", Protocol.Get(action, "button", "left")), "button", 5);
            if (button != "left" && button != "right") throw new Failure("INVALID_REQUEST", "Invalid mouse button");
            Move(point);
            Applications.Verify(state, true);
            ResolvePoint(state, Protocol.Get(action, "point"));
            // Keep down/up together so cancellation cannot leave a click held down.
            Send(Mouse(button == "left" ? 2u : 8u), Mouse(button == "left" ? 4u : 16u));
        }

        private static void Scroll(Snapshot state, Dictionary<string, object> action)
        {
            NoHeldModifiers();
            var point = ResolvePoint(state, Protocol.Get(action, "point"));
            int dx = Protocol.Number(action, "deltaX", -10000, 10000);
            int dy = Protocol.Number(action, "deltaY", -10000, 10000);
            Move(point);
            Applications.Verify(state, true);
            ResolvePoint(state, Protocol.Get(action, "point"));
            if (dy != 0) Send(Mouse(0x800, -dy));
            if (dx != 0)
            {
                Applications.Verify(state, true);
                Send(Mouse(0x1000, dx));
            }
        }

        private static void Drag(Snapshot state, Dictionary<string, object> action)
        {
            NoHeldModifiers();
            var from = ResolvePoint(state, Protocol.Get(action, "from"));
            var to = ResolvePoint(state, Protocol.Get(action, "to"));
            int duration = Protocol.Number(action, "durationMs", 0, 5000, 300);
            Move(from);
            Applications.Verify(state, true);
            ResolvePoint(state, Protocol.Get(action, "from"));
            Send(Mouse(2));
            try
            {
                for (int step = 1; step <= 20; step++)
                {
                    Applications.Verify(state, true);
                    var point = new NativePoint { X = from.X + (to.X - from.X) * step / 20, Y = from.Y + (to.Y - from.Y) * step / 20 };
                    if (NativeMethods.GetAncestor(NativeMethods.WindowFromPoint(point), 2) != state.Window)
                        throw new Failure("TARGET_OBSCURED", "Drag path is covered by another window");
                    Move(point);
                    Thread.Sleep(duration / 20);
                }
            }
            finally { Send(Mouse(4)); }
        }

        private static void TypeText(Snapshot state, string text)
        {
            Focused(state);
            NoHeldModifiers();
            foreach (char character in text)
            {
                Focused(state);
                NoHeldModifiers();
                Send(Key(0, false, character, true), Key(0, true, character, true));
            }
        }

        private static void PressKey(Snapshot state, Dictionary<string, object> action)
        {
            Focused(state);
            NoHeldModifiers();
            ushort key = KeyCode(Protocol.Text(action, "key", 32));
            var raw = Protocol.Get(action, "modifiers", new object[0]) as IList;
            if (raw == null || raw.Count > 4) throw new Failure("INVALID_REQUEST", "Invalid modifiers");
            var modifiers = new List<ushort>();
            foreach (object item in raw)
            {
                ushort modifier = item as string == "control" ? (ushort)0x11 : item as string == "shift" ? (ushort)0x10 :
                    item as string == "option" ? (ushort)0x12 : item as string == "command" ? (ushort)0x5B : (ushort)0;
                if (modifier == 0 || modifiers.Contains(modifier)) throw new Failure("INVALID_REQUEST", "Invalid modifiers");
                modifiers.Add(modifier);
            }
            // Global shortcuts can redirect input outside the approved application.
            if (modifiers.Contains(0x5B) || (modifiers.Contains(0x12) && (key == 9 || key == 27 || key == 32 || key == 0x73)) ||
                (modifiers.Contains(0x11) && (key == 27 || (modifiers.Contains(0x12) && key == 0x2E))))
                throw new Failure("ACTION_UNSUPPORTED", "Global system shortcuts are unsupported");
            var events = new List<NativeInput>();
            foreach (ushort modifier in modifiers) events.Add(Key(modifier, false));
            events.Add(Key(key, false));
            events.Add(Key(key, true));
            for (int index = modifiers.Count - 1; index >= 0; index--) events.Add(Key(modifiers[index], true));
            Focused(state);
            Send(events.ToArray());
        }

        internal static NativePoint ResolvePoint(Snapshot state, object raw, bool requireUnobscured = true)
        {
            var value = Protocol.Map(raw);
            var point = new NativePoint { X = Coordinate(value, "x"), Y = Coordinate(value, "y") };
            if (point.X < state.Frame.Left || point.X >= state.Frame.Right || point.Y < state.Frame.Top || point.Y >= state.Frame.Bottom)
                throw new Failure("POINT_OUTSIDE_TARGET", "Point is outside the observed window");
            if (requireUnobscured && NativeMethods.GetAncestor(NativeMethods.WindowFromPoint(point), 2) != state.Window)
                throw new Failure("TARGET_OBSCURED", "Point is covered by another window");
            return point;
        }

        private static int Coordinate(Dictionary<string, object> point, string key)
        {
            object raw = Protocol.Get(point, key);
            if (!(raw is int) && !(raw is long) && !(raw is decimal) && !(raw is double))
                throw new Failure("INVALID_REQUEST", "Invalid coordinate");
            double number = Convert.ToDouble(raw);
            if (Double.IsNaN(number) || Double.IsInfinity(number) || number < -100000 || number > 100000)
                throw new Failure("INVALID_REQUEST", "Invalid coordinate");
            return (int)Math.Round(number);
        }

        private static void Send(params NativeInput[] inputs)
        {
            if (NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeInput))) != inputs.Length)
                throw new Failure("INPUT_BLOCKED", "Windows rejected input; elevated applications are unsupported");
        }

        private static NativeInput Mouse(uint flags, int data = 0)
        {
            return new NativeInput { data = new InputUnion { mouse = new MouseInput { flags = flags, data = unchecked((uint)data) } } };
        }

        private static NativeInput Key(ushort code, bool up, ushort scan = 0, bool unicode = false)
        {
            return new NativeInput { type = 1, data = new InputUnion { key = new KeyboardInput { vk = code, scan = scan, flags = (up ? 2u : 0u) | (unicode ? 4u : 0u) } } };
        }

        private static void Focused(Snapshot state)
        {
            Applications.Verify(state, true);
            Accessibility.Secure(AutomationElement.FocusedElement, state);
        }

        private static void Move(NativePoint point)
        {
            if (!NativeMethods.SetCursorPos(point.X, point.Y)) throw new Failure("INPUT_BLOCKED", "Cannot move pointer");
        }

        private static void NoHeldModifiers()
        {
            foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
                if ((NativeMethods.GetAsyncKeyState(key) & 0x8000) != 0)
                    throw new Failure("INPUT_BUSY", "Release keyboard modifiers before computer input");
        }

        private static ushort KeyCode(string key)
        {
            ushort result;
            if (Keys.TryGetValue(key, out result)) return result;
            int function;
            if (key.StartsWith("f", StringComparison.OrdinalIgnoreCase) && Int32.TryParse(key.Substring(1), out function) && function >= 1 && function <= 24)
                return (ushort)(0x6F + function);
            if (key.Length == 1 && Char.IsLetterOrDigit(key[0]) && key[0] < 128) return (ushort)Char.ToUpperInvariant(key[0]);
            throw new Failure("INVALID_REQUEST", "Unsupported key; use type_text for Unicode text");
        }
    }
}
