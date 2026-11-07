using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Text;
using System.Threading;

namespace CWPi.ComputerUse
{
    internal static class Transport
    {
        private const int MaxRequestLength = 1000000;
        private static readonly BlockingCollection<string> Incoming = new BlockingCollection<string>(16);

        internal static int Run(bool mcp)
        {
            // Pipes have no console code page when launched hidden by the daemon.
            Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
            var reader = new Thread(() => ReadInput(mcp)) { IsBackground = true };
            reader.Start();
            foreach (string line in Incoming.GetConsumingEnumerable()) ProcessLine(line, mcp);
            return 0;
        }

        private static void ProcessLine(string line, bool mcp)
        {
            object id = mcp ? null : (object)"unknown";
            try
            {
                if (line.Length > MaxRequestLength) throw new Failure("REQUEST_TOO_LARGE", "Request exceeds 1 MB");
                var request = Protocol.Map(Protocol.Json.DeserializeObject(line));
                id = Protocol.Get(request, "id", id);
                RequestContext.Begin(Protocol.Json.Serialize(id));
                RequestContext.CheckDeadline();
                object response = mcp ? Mcp.Handle(request) : Protocol.Obj(
                    "id", Protocol.Text(request, "id", 200), "ok", true,
                    "result", Runtime.Dispatch(Protocol.Text(request, "method"), Protocol.Map(Protocol.Get(request, "params", Protocol.Obj()))));
                if (response != null) Write(response);
            }
            catch (Exception error)
            {
                object response = mcp ? Mcp.Error(id, -32602, Protocol.SafeError(error)) : Protocol.Obj(
                    "id", id, "ok", false, "error", Protocol.Obj(
                        "code", error is Failure ? ((Failure)error).Code : "NATIVE_OPERATION_FAILED",
                        "message", Protocol.SafeError(error)));
                Write(response);
            }
            finally { RequestContext.End(); }
        }

        private static void Write(object response)
        {
            Console.WriteLine(Protocol.Json.Serialize(response));
            Console.Out.Flush();
        }

        private static void ReadInput(bool mcp)
        {
            // Cancellation must be read while UIA or a screenshot is running on the MTA thread.
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (line.Length <= MaxRequestLength)
                    {
                        Dictionary<string, object> request = null;
                        try { request = Protocol.Json.DeserializeObject(line) as Dictionary<string, object>; }
                        catch (ArgumentException) { /* ProcessLine reports malformed JSON. */ }
                        catch (InvalidOperationException) { /* ProcessLine reports invalid serializer input. */ }
                        if (request != null)
                        {
                            if (mcp && Protocol.Get(request, "method") as string == "notifications/cancelled")
                            {
                                var parameters = Protocol.Get(request, "params") as Dictionary<string, object>;
                                object id = parameters == null ? null : Protocol.Get(parameters, "requestId");
                                if (id != null) RequestContext.Cancel(Protocol.Json.Serialize(id));
                                continue;
                            }
                            object requestId = Protocol.Get(request, "id");
                            if (requestId != null) RequestContext.Register(Protocol.Json.Serialize(requestId));
                        }
                    }
                    if (!Incoming.TryAdd(line, 1000)) return;
                }
            }
            catch (IOException) { /* A closed parent pipe ends the helper. */ }
            finally
            {
                RequestContext.Stop();
                Incoming.CompleteAdding();
            }
        }
    }
}
