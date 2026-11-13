using System.IO;
using System.Diagnostics;
using System.Windows.Automation;

namespace PcCaptionBridge;

/// <summary>
/// Reads the caption text out of the Windows 11 Live Captions window through
/// UI Automation (the accessibility interface screen readers use). Live
/// Captions has no API of its own; its text sits in one element with the
/// automation ID "CaptionsTextBlock".
/// </summary>
public sealed class LiveCaptionsReader
{
    const string WindowClass = "LiveCaptionsDesktopWindow";
    const string TextId = "CaptionsTextBlock";
    const string ProcessName = "LiveCaptions";

    AutomationElement? textElement;

    public static bool IsRunning() => Process.GetProcessesByName(ProcessName).Length > 0;

    /// <summary>Starts Live Captions (same as Win+Ctrl+L). Returns false if it couldn't.</summary>
    public static bool Launch()
    {
        try
        {
            var exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "LiveCaptions.exe");
            Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// The current caption text, "" when the window is open but quiet, or null
    /// when Live Captions isn't running (or its window can't be read).
    /// </summary>
    public string? Read()
    {
        if (textElement != null)
        {
            try
            {
                return textElement.Current.Name ?? "";
            }
            catch
            {
                textElement = null; // window closed or rebuilt; look it up again
            }
        }

        textElement = Find();
        if (textElement == null) return null;
        try
        {
            return textElement.Current.Name ?? "";
        }
        catch
        {
            textElement = null;
            return null;
        }
    }

    static AutomationElement? Find()
    {
        try
        {
            var window = AutomationElement.RootElement.FindFirst(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ClassNameProperty, WindowClass));
            if (window == null)
            {
                // Fall back to any top-level window owned by the Live Captions process.
                foreach (var p in Process.GetProcessesByName(ProcessName))
                {
                    window = AutomationElement.RootElement.FindFirst(
                        TreeScope.Children,
                        new PropertyCondition(AutomationElement.ProcessIdProperty, p.Id));
                    if (window != null) break;
                }
            }
            return window?.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.AutomationIdProperty, TextId));
        }
        catch
        {
            return null;
        }
    }
}
