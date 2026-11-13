using System.IO;
using System.Text.Json;
using Microsoft.Win32;

namespace PcCaptionBridge;

/// <summary>Tray app settings, saved in %LOCALAPPDATA%\PcCaptionBridge\settings.json.</summary>
public sealed class AppSettings
{
    public static readonly string Folder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PcCaptionBridge");
    static readonly string FilePath = Path.Combine(Folder, "settings.json");

    public bool HideWhileConnected { get; set; } = true;
    public bool LaunchLiveCaptions { get; set; } = true;

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
        }
        catch
        {
            // Unreadable file: start from defaults.
        }
        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Not worth bothering the user over.
        }
    }
}

/// <summary>"Start with Windows": a value under HKCU\...\Run, so no admin rights needed.</summary>
public static class Autostart
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string ValueName = "PcCaptionBridge";
    public const string Flag = "--autostart";

    static string Command => $"\"{Environment.ProcessPath}\" {Flag}";

    public static bool Enabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is string;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue(ValueName, Command);
            else key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }

    /// <summary>If enabled but pointing at an old copy of the exe, point it at this one.</summary>
    public static void RefreshPath()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        if (key?.GetValue(ValueName) is string current && current != Command) key.SetValue(ValueName, Command);
    }
}

/// <summary>A short status log in %LOCALAPPDATA%\PcCaptionBridge\log.txt, started fresh each run.</summary>
public static class FileLog
{
    public static readonly string FilePath = Path.Combine(AppSettings.Folder, "log.txt");
    static readonly object Gate = new();

    public static void Start()
    {
        try
        {
            Directory.CreateDirectory(AppSettings.Folder);
            File.WriteAllText(FilePath, "");
        }
        catch { }
    }

    public static void Write(string message)
    {
        lock (Gate)
        {
            try
            {
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
            catch { }
        }
    }
}
