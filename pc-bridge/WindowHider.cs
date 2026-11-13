using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace PcCaptionBridge;

/// <summary>
/// Moves the Live Captions window off-screen while the glasses are showing the
/// captions, and puts it back when they stop. Live Captions keeps captioning
/// off-screen (minimizing or hiding it might not), so the bridge can still
/// read it.
///
/// The original position is saved to a file before moving, so if the bridge
/// is killed without a chance to clean up, the next start puts the window
/// back.
/// </summary>
public sealed class WindowHider
{
    static readonly string StateFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PcCaptionBridge", "window-position.txt");

    readonly object gate = new();

    /// <summary>Call once at start, before any window positions are read.</summary>
    public static void UsePhysicalPixels()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor aware v2
        }
        catch
        {
            // Older Windows: positions may be scaled, but moving still works.
        }
    }

    /// <summary>True while the window is (or should be) off-screen because of us.</summary>
    public bool Hidden
    {
        get
        {
            lock (gate) return File.Exists(StateFile);
        }
    }

    /// <summary>
    /// Brings the window to where it should be. Call on every tick: it does
    /// nothing when the window is already right, and copes with Live Captions
    /// being closed, reopened, or moving itself.
    /// </summary>
    /// <returns>"hidden" or "shown" when it moved the window, otherwise null.</returns>
    public string? Sync(bool wantHidden)
    {
        lock (gate)
        {
            if (stopped) wantHidden = false;
            var hwnd = FindWindowHandle();
            if (hwnd == IntPtr.Zero || IsIconic(hwnd) || !GetWindowRect(hwnd, out var r)) return null;
            bool onScreen = OnScreen(r);

            if (wantHidden && onScreen)
            {
                // Save where it was, then move it just past the right edge of all monitors.
                if (!SavePosition(r.Left, r.Top)) return null;
                int offX = GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN) + 2000;
                SetWindowPos(hwnd, IntPtr.Zero, offX, r.Top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                return "hidden";
            }

            if (!wantHidden && !onScreen && LoadPosition() is var (x, y))
            {
                SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                if (GetWindowRect(hwnd, out var back) && OnScreen(back))
                {
                    try { File.Delete(StateFile); } catch { }
                }
                return "shown";
            }

            // Back on screen by other means (the user moved it, or Live Captions reset it).
            if (!wantHidden && onScreen && File.Exists(StateFile))
            {
                try { File.Delete(StateFile); } catch { }
            }
            return null;
        }
    }

    /// <summary>Puts the window back if we moved it.</summary>
    public void Restore() => Sync(false);

    bool stopped;

    /// <summary>Puts the window back for good: later Sync calls won't hide it again. For exit handlers.</summary>
    public void Stop()
    {
        lock (gate) stopped = true;
        Restore();
    }

    static IntPtr FindWindowHandle()
    {
        var hwnd = FindWindowW("LiveCaptionsDesktopWindow", null);
        if (hwnd != IntPtr.Zero) return hwnd;
        foreach (var p in Process.GetProcessesByName("LiveCaptions"))
            if (p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle;
        return IntPtr.Zero;
    }

    /// <summary>True if any part of the window is on some monitor.</summary>
    static bool OnScreen(RECT r)
    {
        var vr = new RECT { Left = GetSystemMetrics(SM_XVIRTUALSCREEN), Top = GetSystemMetrics(SM_YVIRTUALSCREEN) };
        vr.Right = vr.Left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        vr.Bottom = vr.Top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (r.Right <= vr.Left || r.Left >= vr.Right || r.Bottom <= vr.Top || r.Top >= vr.Bottom) return false;
        // Inside the bounding box can still be in a gap between monitors; ask Windows.
        return MonitorFromRect(ref r, MONITOR_DEFAULTTONULL) != IntPtr.Zero;
    }

    static bool SavePosition(int x, int y)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StateFile)!);
            File.WriteAllText(StateFile, $"{x},{y}");
            return true;
        }
        catch
        {
            return false; // without a saved position, don't move it
        }
    }

    static (int, int)? LoadPosition()
    {
        try
        {
            var parts = File.ReadAllText(StateFile).Split(',');
            return (int.Parse(parts[0]), int.Parse(parts[1]));
        }
        catch
        {
            return null;
        }
    }

    // ---- Win32 ----------------------------------------------------------

    [StructLayout(LayoutKind.Sequential)]
    struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;
    const uint SWP_NOSIZE = 0x0001, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;
    const uint MONITOR_DEFAULTTONULL = 0;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowW(string? className, string? windowName);

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    static extern IntPtr MonitorFromRect(ref RECT rect, uint flags);

    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
