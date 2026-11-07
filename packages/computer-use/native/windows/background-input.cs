using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using System.Windows.Automation;

namespace CWPi.ComputerUse
{
    internal static class BackgroundInput
    {
        private const uint ReplaceSelection = 0x00C2;
        private const uint SetSelection = 0x00B1;
        private const uint CharacterInput = 0x0102;
        private const uint MessageFlags = 0x0001 | 0x0002 | 0x0020;
        private const uint MessageTimeoutMs = 1000;

        internal static bool TryPerform(Snapshot state, Dictionary<string, object> action, string kind)
        {
            if (kind != "type_text" && kind != "press_key") return false;
            IntPtr target = state.FocusedWindow;
            if (target == IntPtr.Zero || !IsEditor(target)) return false;
            VerifyTarget(state, target);
            if (kind == "type_text")
            {
                string text = Protocol.Text(action, "text", 20000, true);
                if (text.IndexOf('\0') >= 0) throw new Failure("INVALID_REQUEST", "Text cannot contain a null character");
                if (text.Length == 0) return true;
                UIntPtr result;
                if (NativeMethods.SendWindowText(target, ReplaceSelection, new IntPtr(1), text, MessageFlags, MessageTimeoutMs, out result) == IntPtr.Zero)
                    throw Unconfirmed();
            }
            else
            {
                string key = Protocol.Text(action, "key", 32);
                var modifiers = Protocol.Get(action, "modifiers", new object[0]) as IList;
                if (modifiers == null) throw new Failure("INVALID_REQUEST", "Invalid modifiers");
                uint message;
                IntPtr parameter;
                IntPtr value = IntPtr.Zero;
                if (modifiers.Count == 1 && modifiers[0] as string == "control" && String.Equals(key, "a", StringComparison.OrdinalIgnoreCase))
                {
                    message = SetSelection;
                    parameter = IntPtr.Zero;
                    value = new IntPtr(-1);
                }
                else if (modifiers.Count == 0 && String.Equals(key, "backspace", StringComparison.OrdinalIgnoreCase))
                {
                    message = CharacterInput;
                    parameter = new IntPtr(8);
                }
                else if (modifiers.Count == 0 && (String.Equals(key, "enter", StringComparison.OrdinalIgnoreCase) || String.Equals(key, "return", StringComparison.OrdinalIgnoreCase)))
                {
                    // Only multiline editors can interpret Enter without depending on a dialog's focus routing.
                    if ((NativeMethods.GetWindowStyle(target, -16) & 0x0004) == 0) return false;
                    message = CharacterInput;
                    parameter = new IntPtr(13);
                }
                else return false;
                VerifyTarget(state, target);
                UIntPtr result;
                if (NativeMethods.SendWindowMessage(target, message, parameter, value, MessageFlags, MessageTimeoutMs, out result) == IntPtr.Zero)
                    throw Unconfirmed();
            }
            // A returned window message is not proof of a business outcome; the caller still reobserves.
            VerifyTarget(state, target);
            return true;
        }

        private static bool IsEditor(IntPtr window)
        {
            if (!NativeMethods.IsWindowUnicode(window)) return false;
            var name = new StringBuilder(256);
            if (NativeMethods.GetClassName(window, name, name.Capacity) == 0) return false;
            string value = name.ToString();
            return String.Equals(value, "Edit", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(value, "RichEdit20W", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(value, "RICHEDIT50W", StringComparison.OrdinalIgnoreCase);
        }

        private static void VerifyTarget(Snapshot state, IntPtr target)
        {
            Applications.Verify(state);
            if (Applications.FocusedWindow(state) != target || !IsEditor(target))
                throw new Failure("TARGET_CHANGED", "The observed editor or its focus changed; observe again");
            Accessibility.Secure(AutomationElement.FromHandle(target), state);
            int style = NativeMethods.GetWindowStyle(target, -16);
            if ((style & 0x0020) != 0) throw new Failure("SECURE_INPUT_PROTECTED", "Password fields cannot be controlled");
            if ((style & 0x0800) != 0) throw new Failure("ACTION_UNSUPPORTED", "The observed editor is read-only");
            RequestContext.CheckDeadline();
        }

        private static Failure Unconfirmed()
        {
            // Timeout can occur after a partial change; never repeat through SendInput.
            return new Failure("INPUT_DELIVERY_UNCONFIRMED", "Cannot confirm editor input delivery; observe again before any further action");
        }
    }
}
