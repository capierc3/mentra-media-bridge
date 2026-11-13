using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace PcCaptionBridge;

/// <summary>
/// A very small GET-only JSON server on a plain TCP socket. HttpListener would
/// need admin rights (a URL reservation) to listen beyond localhost; this
/// doesn't.
/// </summary>
public sealed class TinyHttpServer
{
    readonly int port;
    readonly Func<string, Task<string?>> handler;

    /// <param name="handler">Gets the path ("/caption"), returns JSON, or null for 404.</param>
    public TinyHttpServer(int port, Func<string, Task<string?>> handler)
    {
        this.port = port;
        this.handler = handler;
    }

    public void Start()
    {
        var listener = new TcpListener(IPAddress.Any, port);
        listener.Start();
        _ = Task.Run(async () =>
        {
            while (true)
            {
                var client = await listener.AcceptTcpClientAsync();
                _ = Task.Run(() => Serve(client));
            }
        });
    }

    async Task Serve(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 3000;
                client.SendTimeout = 3000;
                var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, false, 4096, leaveOpen: true);
                var requestLine = await reader.ReadLineAsync() ?? "";
                // Skip the headers.
                string? header;
                while (!string.IsNullOrEmpty(header = await reader.ReadLineAsync())) { }

                var parts = requestLine.Split(' ');
                var method = parts.Length > 0 ? parts[0] : "";
                var path = parts.Length > 1 ? parts[1].Split('?')[0] : "/";

                string status, body;
                if (method == "OPTIONS")
                {
                    status = "204 No Content";
                    body = "";
                }
                else if (method != "GET")
                {
                    status = "405 Method Not Allowed";
                    body = "{\"error\":\"method_not_allowed\"}";
                }
                else
                {
                    var json = await handler(path);
                    status = json == null ? "404 Not Found" : "200 OK";
                    body = json ?? "{\"error\":\"not_found\"}";
                }

                var bytes = Encoding.UTF8.GetBytes(body);
                var head =
                    $"HTTP/1.1 {status}\r\n" +
                    "Content-Type: application/json; charset=utf-8\r\n" +
                    $"Content-Length: {bytes.Length}\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
                    "Access-Control-Allow-Headers: *\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "Connection: close\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
                await stream.WriteAsync(bytes);
            }
            catch
            {
                // Client went away mid-request; nothing to do.
            }
        }
    }
}
