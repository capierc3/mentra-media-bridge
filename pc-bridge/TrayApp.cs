using System.Diagnostics;
using System.Reflection;
using Microsoft.Win32;

namespace PcCaptionBridge;

/// <summary>The system tray icon and its menu.</summary>
public sealed class TrayApp : ApplicationContext
{
    readonly Bridge bridge;
    readonly AppSettings settings;
    readonly NotifyIcon icon;
    readonly System.Windows.Forms.Timer refresh;

    readonly ToolStripMenuItem statusItem;
    readonly ToolStripMenuItem addressesItem;
    readonly ToolStripMenuItem pauseItem;
    readonly ToolStripMenuItem hideItem;
    readonly ToolStripMenuItem openLiveCaptionsItem;
    readonly ToolStripMenuItem autostartItem;

    TrayState? shownState;
    string addressesKey = "";

    public TrayApp(Bridge bridge, AppSettings settings, bool showWelcome)
    {
        this.bridge = bridge;
        this.settings = settings;

        var title = new ToolStripMenuItem("PC Caption Bridge") { Enabled = false, Font = new Font(SystemFonts.MenuFont ?? Control.DefaultFont, FontStyle.Bold) };
        statusItem = new ToolStripMenuItem("Starting…") { Enabled = false };
        addressesItem = new ToolStripMenuItem("PC address");
        pauseItem = new ToolStripMenuItem("Pause captions", null, (_, _) => TogglePause());
        hideItem = new ToolStripMenuItem("Hide Live Captions while connected", null, (_, _) => ToggleHide())
        {
            Checked = settings.HideWhileConnected,
        };
        openLiveCaptionsItem = new ToolStripMenuItem("Open Live Captions", null, (_, _) => LiveCaptionsReader.Launch());
        autostartItem = new ToolStripMenuItem("Start with Windows", null, (_, _) => ToggleAutostart());

        var menu = new ContextMenuStrip();
        menu.Items.AddRange(new ToolStripItem[]
        {
            title,
            statusItem,
            addressesItem,
            new ToolStripSeparator(),
            pauseItem,
            hideItem,
            openLiveCaptionsItem,
            new ToolStripSeparator(),
            autostartItem,
            new ToolStripMenuItem("Open log", null, (_, _) => OpenLog()),
            new ToolStripSeparator(),
            new ToolStripMenuItem("Quit", null, (_, _) => Quit()),
        });
        menu.Opening += (_, _) => UpdateMenu();

        icon = new NotifyIcon { ContextMenuStrip = menu, Visible = true };
        // Left click opens the same menu as right click.
        icon.MouseUp += (_, e) =>
        {
            if (e.Button == MouseButtons.Left)
                typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic)
                    ?.Invoke(icon, null);
        };

        UpdateIcon();
        refresh = new System.Windows.Forms.Timer { Interval = 500 };
        refresh.Tick += (_, _) => UpdateIcon();
        refresh.Start();

        SystemEvents.SessionEnding += (_, _) => bridge.Stop();

        if (showWelcome)
        {
            var addr = Bridge.LanAddresses().Select(a => a.Address).FirstOrDefault();
            icon.ShowBalloonTip(
                5000,
                "PC Caption Bridge is running",
                addr != null
                    ? $"In the miniapp, choose Source: PC and enter {addr}. Click the CC icon for options."
                    : "Click the CC icon by the clock for options.",
                ToolTipIcon.Info);
        }
    }

    TrayState CurrentState() =>
        bridge.Paused ? TrayState.Paused
        : !bridge.LiveCaptionsOpen ? TrayState.NoLiveCaptions
        : bridge.Connected ? TrayState.Connected
        : TrayState.Waiting;

    static string StatusText(TrayState s) => s switch
    {
        TrayState.Paused => "Paused: not sharing captions",
        TrayState.NoLiveCaptions => "Live Captions is closed",
        TrayState.Connected => "Glasses connected",
        _ => "Waiting for glasses",
    };

    void UpdateIcon()
    {
        var state = CurrentState();
        if (state == shownState) return;
        shownState = state;
        icon.Icon = TrayIcons.For(state, SystemInformation.SmallIconSize.Width);
        icon.Text = $"PC Caption Bridge\n{StatusText(state)}";
        statusItem.Text = StatusText(state);
    }

    void UpdateMenu()
    {
        var state = CurrentState();
        statusItem.Text = StatusText(state);
        pauseItem.Text = bridge.Paused ? "Resume captions" : "Pause captions";
        hideItem.Checked = settings.HideWhileConnected;
        openLiveCaptionsItem.Visible = !bridge.LiveCaptionsOpen;
        autostartItem.Checked = Autostart.Enabled;

        // PC addresses: click one to copy it.
        var addrs = Bridge.LanAddresses();
        var key = string.Join(",", addrs);
        if (key != addressesKey)
        {
            addressesKey = key;
            addressesItem.DropDownItems.Clear();
            foreach (var (address, adapter) in addrs)
            {
                var a = address;
                addressesItem.DropDownItems.Add($"Copy {a}   ({adapter})", null, (_, _) => Clipboard.SetText(a));
            }
        }
        addressesItem.Text = addrs.Count switch
        {
            0 => "PC address: not on a network",
            1 => $"PC address: {addrs[0].Address}",
            _ => $"PC address: {addrs[0].Address} (+{addrs.Count - 1})",
        };
        addressesItem.Enabled = addrs.Count > 0;
    }

    void TogglePause()
    {
        bridge.Paused = !bridge.Paused;
        UpdateIcon();
    }

    void ToggleHide()
    {
        settings.HideWhileConnected = !settings.HideWhileConnected;
        bridge.HideWhileConnected = settings.HideWhileConnected;
        settings.Save();
    }

    void ToggleAutostart()
    {
        try
        {
            Autostart.Enabled = !Autostart.Enabled;
        }
        catch (Exception e)
        {
            MessageBox.Show($"Couldn't change Start with Windows: {e.Message}", "PC Caption Bridge",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    static void OpenLog()
    {
        try
        {
            Process.Start(new ProcessStartInfo("notepad.exe", $"\"{FileLog.FilePath}\"") { UseShellExecute = true });
        }
        catch { }
    }

    void Quit()
    {
        refresh.Stop();
        bridge.Stop();
        icon.Visible = false;
        icon.Dispose();
        ExitThread();
    }
}
