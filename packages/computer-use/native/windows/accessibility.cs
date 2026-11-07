using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Windows.Automation;

namespace CWPi.ComputerUse
{
    internal static class Accessibility
    {
        private const int MaxTreeLength = 190000;

        internal static string Observe(Snapshot state, int maxDepth, int maxNodes, out bool truncated)
        {
            var tree = new StringBuilder();
            truncated = false;
            Walk(AutomationElement.FromHandle(state.Window), state, tree, 0, maxDepth, maxNodes, ref truncated);
            return tree.ToString();
        }

        private static void Walk(AutomationElement element, Snapshot state, StringBuilder tree, int depth, int maxDepth, int maxNodes, ref bool truncated)
        {
            RequestContext.CheckDeadline();
            if (state.Elements.Count >= maxNodes || tree.Length > MaxTreeLength)
            {
                truncated = true;
                return;
            }
            var current = element.Current;
            if (current.ProcessId != state.Pid) return;
            int id = state.Elements.Count;
            var bounds = current.BoundingRectangle;
            state.Elements.Add(element);
            state.ElementBounds.Add(bounds);
            tree.Append(' ', depth * 2).Append(id).Append(' ').Append(current.ControlType.ProgrammaticName).Append(' ')
                .Append(Protocol.Json.Serialize(current.IsPassword ? "[protected]" : current.Name.Substring(0, Math.Min(current.Name.Length, 500))));
            if (current.IsPassword) tree.Append(" password");
            else
            {
                if (!String.IsNullOrEmpty(current.AutomationId))
                    tree.Append(" id=").Append(Protocol.Json.Serialize(current.AutomationId.Substring(0, Math.Min(current.AutomationId.Length, 500))));
                tree.Append(current.IsEnabled ? " enabled" : " disabled");
                if (state.FocusedWindow != IntPtr.Zero && new IntPtr(current.NativeWindowHandle) == state.FocusedWindow) tree.Append(" focused");
                tree.Append(" actions=").Append(String.Join(",", Actions(element)));
            }
            if (!bounds.IsEmpty)
                tree.Append(" bounds=").Append(Protocol.Json.Serialize(new double[] { bounds.X, bounds.Y, bounds.Width, bounds.Height }));
            object rangePattern;
            if (!current.IsPassword && element.TryGetCurrentPattern(RangeValuePattern.Pattern, out rangePattern))
            {
                var range = ((RangeValuePattern)rangePattern).Current;
                tree.Append(" range=").Append(Protocol.Json.Serialize(new double[] { range.Minimum, range.Maximum }))
                    .Append(" value=").Append(range.Value.ToString(CultureInfo.InvariantCulture));
            }
            tree.AppendLine();

            var walker = TreeWalker.ControlViewWalker;
            var child = walker.GetFirstChild(element);
            if (depth >= maxDepth)
            {
                if (child != null) truncated = true;
                return;
            }
            while (child != null)
            {
                RequestContext.CheckDeadline();
                if (state.Elements.Count >= maxNodes || tree.Length > MaxTreeLength)
                {
                    truncated = true;
                    break;
                }
                Walk(child, state, tree, depth + 1, maxDepth, maxNodes, ref truncated);
                child = walker.GetNextSibling(child);
            }
        }

        private static List<string> Actions(AutomationElement element)
        {
            var actions = new List<string>();
            object pattern;
            if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) actions.Add("invoke");
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) actions.Add("toggle");
            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) actions.Add("select");
            if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
            {
                actions.Add("expand");
                actions.Add("collapse");
            }
            if ((element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) ||
                (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern) && !((RangeValuePattern)pattern).Current.IsReadOnly))
                actions.Add("set_value");
            if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern))
            {
                var scroll = ((ScrollPattern)pattern).Current;
                if (scroll.VerticallyScrollable) { actions.Add("scroll_up"); actions.Add("scroll_down"); }
                if (scroll.HorizontallyScrollable) { actions.Add("scroll_left"); actions.Add("scroll_right"); }
            }
            return actions;
        }

        private static bool Descendant(AutomationElement element, IntPtr window)
        {
            var root = AutomationElement.FromHandle(window);
            for (int index = 0; element != null && index < 100; index++, element = TreeWalker.ControlViewWalker.GetParent(element))
            {
                RequestContext.CheckDeadline();
                if (Automation.Compare(element, root)) return true;
            }
            return false;
        }

        internal static void Secure(AutomationElement element, Snapshot state)
        {
            if (element == null || element.Current.ProcessId != state.Pid || !Descendant(element, state.Window))
                throw new Failure("TARGET_CHANGED", "Cannot verify target element");
            if (element.Current.IsPassword)
                throw new Failure("SECURE_INPUT_PROTECTED", "Password fields cannot be controlled");
            if (!element.Current.IsEnabled)
                throw new Failure("ELEMENT_DISABLED", "Target element is disabled; observe again");
        }

        private static AutomationElement ResolveElement(Snapshot state, Dictionary<string, object> action)
        {
            var element = state.Elements[Protocol.Number(action, "elementId", 0, state.Elements.Count - 1)];
            Secure(element, state);
            return element;
        }

        internal static NativePoint? ActionPoint(Snapshot state, Dictionary<string, object> action)
        {
            var bounds = ResolveElement(state, action).Current.BoundingRectangle;
            if (bounds.IsEmpty) return null;
            double x = bounds.X + bounds.Width / 2;
            double y = bounds.Y + bounds.Height / 2;
            if (Double.IsNaN(x) || Double.IsNaN(y) || Double.IsInfinity(x) || Double.IsInfinity(y) ||
                x < state.Frame.Left || x >= state.Frame.Right || y < state.Frame.Top || y >= state.Frame.Bottom)
                return null;
            return new NativePoint { X = (int)Math.Round(x), Y = (int)Math.Round(y) };
        }

        internal static void PerformAction(Snapshot state, Dictionary<string, object> action, string kind)
        {
            PerformElementAction(state, ResolveElement(state, action), action, kind);
        }

        private static void PerformElementAction(Snapshot state, AutomationElement element, Dictionary<string, object> action, string kind)
        {
            Secure(element, state);
            string name = kind == "press" ? "invoke" : kind == "set_value" ? "set_value" : Protocol.Text(action, "action", 200);
            object pattern;
            // UIA targets the observed element directly; never fall back to foreground input or SetFocus.
            Applications.Verify(state);
            if (name == "invoke" && element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
                ((InvokePattern)pattern).Invoke();
            else if (name == "toggle" && element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
                ((TogglePattern)pattern).Toggle();
            else if (name == "select" && element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
                ((SelectionItemPattern)pattern).Select();
            else if (name == "expand" && element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
                ((ExpandCollapsePattern)pattern).Expand();
            else if (name == "collapse" && element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
                ((ExpandCollapsePattern)pattern).Collapse();
            else if (name == "set_value" && element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly)
                ((ValuePattern)pattern).SetValue(Protocol.Text(action, "value", 20000, true));
            else if (name == "set_value" && element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern) && !((RangeValuePattern)pattern).Current.IsReadOnly)
            {
                double value;
                if (!Double.TryParse(Protocol.Text(action, "value", 20000), NumberStyles.Float, CultureInfo.InvariantCulture, out value) ||
                    Double.IsNaN(value) || Double.IsInfinity(value))
                    throw new Failure("INVALID_REQUEST", "Range value must be a finite number");
                ((RangeValuePattern)pattern).SetValue(value);
            }
            else if ((name == "scroll_up" || name == "scroll_down" || name == "scroll_left" || name == "scroll_right") &&
                element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern))
            {
                var scroll = (ScrollPattern)pattern;
                bool horizontal = name == "scroll_left" || name == "scroll_right";
                if ((horizontal && !scroll.Current.HorizontallyScrollable) || (!horizontal && !scroll.Current.VerticallyScrollable))
                    throw new Failure("ACTION_UNSUPPORTED", "Element cannot scroll in the requested direction");
                var amount = name == "scroll_up" || name == "scroll_left" ? ScrollAmount.SmallDecrement : ScrollAmount.SmallIncrement;
                scroll.Scroll(horizontal ? amount : ScrollAmount.NoAmount, horizontal ? ScrollAmount.NoAmount : amount);
            }
            else
                throw new Failure("ACTION_UNSUPPORTED", "Element does not expose that action");
        }
        private static AutomationElement ElementAt(Snapshot state, NativePoint point)
        {
            int closest = -1;
            double area = Double.PositiveInfinity;
            // Hit-test the observed bounds locally; scanning live UIA properties can require thousands of RPCs.
            for (int index = 0; index < state.ElementBounds.Count; index++)
            {
                RequestContext.CheckDeadline();
                var bounds = state.ElementBounds[index];
                if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0 ||
                    point.X < bounds.Left || point.X >= bounds.Right || point.Y < bounds.Top || point.Y >= bounds.Bottom)
                    continue;
                double candidate = bounds.Width * bounds.Height;
                if (candidate <= area) { area = candidate; closest = index; }
            }
            if (closest < 0) return null;
            var element = state.Elements[closest];
            Secure(element, state);
            var current = element.Current.BoundingRectangle;
            if (current.IsEmpty || point.X < current.Left || point.X >= current.Right || point.Y < current.Top || point.Y >= current.Bottom)
                throw new Failure("TARGET_CHANGED", "The observed control moved; observe again");
            return element;
        }

        internal static bool TryClick(Snapshot state, NativePoint point)
        {
            var element = ElementAt(state, point);
            for (int depth = 0; element != null && depth < 50; depth++)
            {
                Secure(element, state);
                object pattern;
                string action = null;
                if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) action = "invoke";
                else if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) action = "toggle";
                else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) action = "select";
                else if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
                    action = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState == ExpandCollapseState.Collapsed ? "expand" : "collapse";
                if (action != null)
                {
                    PerformElementAction(state, element, Protocol.Obj("action", action), "perform_action");
                    return true;
                }
                if (Automation.Compare(element, AutomationElement.FromHandle(state.Window))) break;
                element = TreeWalker.ControlViewWalker.GetParent(element);
            }
            return false;
        }

        internal static bool TryScroll(Snapshot state, NativePoint point, int dx, int dy)
        {
            var element = ElementAt(state, point);
            for (int depth = 0; element != null && depth < 50; depth++)
            {
                Secure(element, state);
                object pattern;
                if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern))
                {
                    var scroll = (ScrollPattern)pattern;
                    if ((dx != 0 && !scroll.Current.HorizontallyScrollable) || (dy != 0 && !scroll.Current.VerticallyScrollable))
                        return false;
                    int horizontalSteps = (int)Math.Ceiling(Math.Abs(dx) / 120.0);
                    int verticalSteps = (int)Math.Ceiling(Math.Abs(dy) / 120.0);
                    // ScrollPattern uses control-defined steps, not a universal pixel distance.
                    for (int step = 0; step < Math.Max(horizontalSteps, verticalSteps); step++)
                    {
                        Applications.Verify(state);
                        Secure(element, state);
                        var horizontal = step < horizontalSteps ? (dx > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement) : ScrollAmount.NoAmount;
                        var vertical = step < verticalSteps ? (dy > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement) : ScrollAmount.NoAmount;
                        scroll.Scroll(horizontal, vertical);
                    }
                    return true;
                }
                if (Automation.Compare(element, AutomationElement.FromHandle(state.Window))) break;
                element = TreeWalker.ControlViewWalker.GetParent(element);
            }
            return false;
        }

    }
}
