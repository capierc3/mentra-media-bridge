using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;

namespace PcCaptionBridge;

/// <summary>
/// The bridge itself: reads Live Captions on a timer, serves captions and
/// now-playing info in the Media Bridge format, and moves the Live Captions
/// window off-screen while the glasses are connected. Used by both the tray
/// app and the console mode.
///
///   GET http://&lt;pc&gt;:8767/caption   captions
///   GET http://&lt;pc&gt;:8766/media     now playing
/// </summary>
public sealed class Bridge
{
    public const int CaptionPort = 8767;
    public const int MediaPort = 8766;
    const int ReadEveryMs = 200;
    const int SilentAfterSec = 5;
    /// <summary>The miniapp counts as connected while it has asked for captions this recently.</summary>
    const int ConnectedForMs = 5000;

    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    readonly CaptionTracker tracker = new();
    readonly LiveCaptionsReader reader = new();
    readonly MediaReader media = new();
    readonly WindowHider hider = new();

    long lastCaptionRequestMs;
    string captionJson = "{}";
    string mediaJson = "{\"enabled\":true,\"playing\":false,\"state\":\"none\"}";
    volatile bool running;
    volatile bool liveCaptionsOpen;
    volatile bool connected;

    /// <summary>Status messages ("Glasses connected.").</summary>
    public event Action<string>? Log;
    /// <summary>Each new finished caption line, for the console.</summary>
    public event Action<string>? CaptionLine;

    /// <summary>While paused, nothing is shared and Live Captions stays on screen.</summary>
    public volatile bool Paused;
    public volatile bool HideWhileConnected = true;

    public bool Connected => connected;
    public bool LiveCaptionsOpen => liveCaptionsOpen;

    /// <summary>
    /// Opens the ports and starts reading. Throws if a port is taken (another
    /// copy running, or Media Bridge forwarded over USB).
    /// </summary>
    public void Start(bool launchLiveCaptions)
    {
        // Put Live Captions back if a previous run was killed while it was hidden.
        hider.Restore();

        new TinyHttpServer(CaptionPort, path =>
        {
            if (path is not ("/caption" or "/")) return Task.FromResult<string?>(null);
            Interlocked.Exchange(ref lastCaptionRequestMs, Now());
            return Task.FromResult<string?>(Volatile.Read(ref captionJson));
        }).Start();
        new TinyHttpServer(MediaPort, path =>
            Task.FromResult<string?>(path is "/media" or "/" ? Volatile.Read(ref mediaJson) : null)).Start();

        if (launchLiveCaptions && !LiveCaptionsReader.IsRunning())
        {
            Log?.Invoke(LiveCaptionsReader.Launch()
                ? "Started Windows Live Captions."
                : "Couldn't start Live Captions. Open it with Win+Ctrl+L.");
        }

        running = true;
        new Thread(CaptionLoop) { IsBackground = true, Name = "captions" }.Start();
        _ = Task.Run(MediaLoop);
    }

    /// <summary>Puts Live Captions back on screen for good. Call on exit.</summary>
    public void Stop()
    {
        running = false;
        hider.Stop();
    }

    void CaptionLoop()
    {
        string lastShown = "";
        bool? lastFound = null;
        bool? lastConnected = null;
        bool? lastPaused = null;

        while (running)
        {
            try
            {
                var text = reader.Read();
                var now = Now();
                liveCaptionsOpen = text != null;
                if (text != null) tracker.Update(text, now);
                Volatile.Write(ref captionJson, BuildCaptionJson(now));

                connected = now - Interlocked.Read(ref lastCaptionRequestMs) < ConnectedForMs;
                if (lastConnected != connected)
                {
                    if (lastConnected != null || connected)
                        Log?.Invoke(connected ? "Glasses connected." : "Glasses disconnected.");
                    lastConnected = connected;
                }
                if (lastPaused != Paused)
                {
                    if (lastPaused != null) Log?.Invoke(Paused ? "Paused." : "Resumed.");
                    lastPaused = Paused;
                }

                switch (hider.Sync(HideWhileConnected && connected && !Paused))
                {
                    case "hidden": Log?.Invoke("Moved Live Captions off-screen."); break;
                    case "shown": Log?.Invoke("Live Captions is back on screen."); break;
                }

                if (lastFound != liveCaptionsOpen)
                {
                    lastFound = liveCaptionsOpen;
                    Log?.Invoke(liveCaptionsOpen
                        ? "Live Captions found. Captions are flowing."
                        : "Waiting for Live Captions (press Win+Ctrl+L to open it)...");
                }
                var newest = tracker.Lines.Count > 0 ? tracker.Lines[^1].Text : "";
                if (newest != lastShown && newest.Length > 0)
                {
                    lastShown = newest;
                    CaptionLine?.Invoke(newest);
                }
            }
            catch (Exception e)
            {
                Log?.Invoke($"Error reading captions: {e.Message}");
            }
            Thread.Sleep(ReadEveryMs);
        }
    }

    async Task MediaLoop()
    {
        while (running)
        {
            var m = Paused
                ? new Dictionary<string, object?> { ["enabled"] = false, ["playing"] = false, ["state"] = "none" }
                : await media.ReadAsync();
            Volatile.Write(ref mediaJson, JsonSerializer.Serialize(m, Json));
            await Task.Delay(1000);
        }
    }

    string BuildCaptionJson(long now)
    {
        if (Paused)
        {
            return JsonSerializer.Serialize(new
            {
                running = false,
                status = "paused",
                engine = "Windows Live Captions",
                silentForSec = 0,
                seq = tracker.Seq,
                partial = "",
                lines = Array.Empty<object>(),
            }, Json);
        }
        var silentFor = tracker.LastChangeMs == 0 ? 0 : (now - tracker.LastChangeMs) / 1000.0;
        var status = !liveCaptionsOpen ? "stopped" : silentFor >= SilentAfterSec ? "silent" : "ok";
        return JsonSerializer.Serialize(new
        {
            running = liveCaptionsOpen,
            status,
            engine = "Windows Live Captions",
            silentForSec = Math.Round(silentFor, 1),
            seq = tracker.Seq,
            partial = tracker.Partial,
            lines = tracker.Lines.Select(l => new { id = l.Id, text = l.Text, t = l.T }),
        }, Json);
    }

    static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// <summary>The PC's addresses on the local network, with the adapter name.</summary>
    public static List<(string Address, string Adapter)> LanAddresses()
    {
        var list = new List<(string, string)>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            var props = nic.GetIPProperties();
            // Skip virtual adapters (Hyper-V, WSL, VPNs) that have no gateway.
            if (!props.GatewayAddresses.Any(g =>
                    g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any)))
                continue;
            foreach (var a in props.UnicastAddresses)
                if (a.Address.AddressFamily == AddressFamily.InterNetwork)
                    list.Add((a.Address.ToString(), nic.Name));
        }
        return list;
    }
}
