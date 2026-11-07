using System.Collections.Concurrent;
using System.Diagnostics;

namespace CWPi.ComputerUse
{
    internal static class RequestContext
    {
        private const long ExecutionTimeoutMs = 12000;
        private static readonly ConcurrentDictionary<string, bool> Requests = new ConcurrentDictionary<string, bool>();
        private static readonly Stopwatch Clock = new Stopwatch();
        private static volatile bool closed;
        private static string requestKey;

        internal static void Register(string key)
        {
            Requests.TryAdd(key, false);
        }

        internal static void Cancel(string key)
        {
            // Do not create entries for unknown cancellation IDs.
            Requests.TryUpdate(key, true, false);
        }

        internal static void Begin(string key)
        {
            requestKey = key;
            Clock.Restart();
        }

        internal static void End()
        {
            bool ignored;
            if (requestKey != null) Requests.TryRemove(requestKey, out ignored);
            requestKey = null;
            Clock.Reset();
        }

        internal static void Stop()
        {
            closed = true;
        }

        internal static void CheckDeadline()
        {
            bool cancelled;
            if (closed || (requestKey != null && Requests.TryGetValue(requestKey, out cancelled) && cancelled))
                throw new Failure("OPERATION_ABORTED", "Desktop operation was cancelled");
            if (Clock.ElapsedMilliseconds >= ExecutionTimeoutMs)
                throw new Failure("HELPER_TIMEOUT", "Desktop operation exceeded its time limit");
        }
    }
}
