using System;
using System.Collections.Generic;
using System.Threading;
using System.Web.Script.Serialization;

namespace CWPi.ComputerUse
{
    internal static class ComputerInputMethod
    {
        internal const string UIA = "uia";
        internal const string WINDOW_MESSAGE = "window_message";
        internal const string FOREGROUND_INPUT = "foreground_input";
    }

    internal sealed class Failure : Exception
    {
        internal readonly string Code;

        internal Failure(string code, string message) : base(message)
        {
            Code = code;
        }
    }

    internal static class Protocol
    {
        private static readonly ThreadLocal<JavaScriptSerializer> Serializers =
            new ThreadLocal<JavaScriptSerializer>(() => new JavaScriptSerializer { MaxJsonLength = 24000000 });

        internal static JavaScriptSerializer Json { get { return Serializers.Value; } }

        internal static Dictionary<string, object> Obj(params object[] pairs)
        {
            var result = new Dictionary<string, object>();
            for (int i = 0; i < pairs.Length; i += 2) result.Add((string)pairs[i], pairs[i + 1]);
            return result;
        }

        internal static Dictionary<string, object> Map(object value)
        {
            var result = value as Dictionary<string, object>;
            if (result == null) throw new Failure("INVALID_REQUEST", "Expected an object");
            return result;
        }

        internal static object Get(Dictionary<string, object> value, string key, object fallback = null)
        {
            object result;
            return value.TryGetValue(key, out result) ? result : fallback;
        }

        internal static string Text(Dictionary<string, object> value, string key, int limit = 500, bool empty = false)
        {
            var result = Get(value, key) as string;
            if (result == null || (!empty && String.IsNullOrWhiteSpace(result)) || result.Length > limit)
                throw new Failure("INVALID_REQUEST", "Invalid " + key);
            return result;
        }

        internal static int Number(Dictionary<string, object> value, string key, int min, int max, int? fallback = null)
        {
            var raw = Get(value, key, fallback);
            if (!(raw is int) && !(raw is long) && !(raw is decimal) && !(raw is double))
                throw new Failure("INVALID_REQUEST", "Invalid " + key);
            double number = Convert.ToDouble(raw);
            if (Double.IsNaN(number) || Double.IsInfinity(number) || number != Math.Truncate(number) || number < min || number > max)
                throw new Failure("INVALID_REQUEST", "Invalid " + key);
            return (int)number;
        }

        internal static long Now()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        internal static string SafeError(Exception error)
        {
            var failure = error as Failure;
            return failure == null
                ? "[NATIVE_OPERATION_FAILED] Windows desktop operation failed; restore the target window and observe again"
                : "[" + failure.Code + "] " + failure.Message;
        }
    }
}
