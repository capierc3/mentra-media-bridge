using Windows.Media.Control;

namespace PcCaptionBridge;

/// <summary>
/// What's playing on the PC, from Windows' media controls (the same info as
/// the volume flyout). Shaped like Media Bridge's GET /media so the miniapp's
/// track title and time bar work unchanged.
/// </summary>
public sealed class MediaReader
{
    GlobalSystemMediaTransportControlsSessionManager? manager;

    public async Task<Dictionary<string, object?>> ReadAsync()
    {
        var result = new Dictionary<string, object?> { ["enabled"] = true, ["playing"] = false, ["state"] = "none" };
        try
        {
            manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var session = manager.GetCurrentSession();
            if (session == null) return result;

            var props = await session.TryGetMediaPropertiesAsync();
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();

            var state = playback.PlaybackStatus switch
            {
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped => "stopped",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Changing => "buffering",
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Closed => "none",
                _ => "unknown",
            };

            long duration = (long)(timeline.EndTime - timeline.StartTime).TotalMilliseconds;
            long position = -1;
            if (duration > 0)
            {
                // Windows reports a snapshot from the player's last update; bring it up to now.
                var pos = timeline.Position - timeline.StartTime;
                if (state == "playing" && timeline.LastUpdatedTime.Year > 2000)
                    pos += DateTimeOffset.Now - timeline.LastUpdatedTime;
                position = Math.Clamp((long)pos.TotalMilliseconds, 0, duration);
            }
            else duration = -1;

            result["state"] = state;
            result["playing"] = state == "playing";
            result["app"] = FriendlyAppName(session.SourceAppUserModelId);
            result["title"] = props?.Title ?? "";
            result["artist"] = props?.Artist ?? "";
            result["album"] = props?.AlbumTitle ?? "";
            result["position"] = position;
            result["duration"] = duration;
            result["live"] = false;
        }
        catch (Exception e)
        {
            result["error"] = e.Message;
        }
        return result;
    }

    /// <summary>"Spotify.exe" → "Spotify", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" → "ZuneMusic".</summary>
    static string FriendlyAppName(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return "";
        var name = id;
        var bang = name.LastIndexOf('!');
        if (bang >= 0) name = name[(bang + 1)..];
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        var dot = name.LastIndexOf('.');
        if (dot >= 0 && dot < name.Length - 1) name = name[(dot + 1)..];
        // Some apps register under a bare hex ID, which means nothing on the glasses.
        if (name.Length >= 12 && name.All(Uri.IsHexDigit)) return "";
        return name switch
        {
            "chrome" => "Chrome",
            "msedge" or "MicrosoftEdge" => "Edge",
            "firefox" => "Firefox",
            "ZuneMusic" => "Media Player",
            "ZuneVideo" => "Movies & TV",
            _ => name.Length > 0 ? char.ToUpperInvariant(name[0]) + name[1..] : name,
        };
    }
}
