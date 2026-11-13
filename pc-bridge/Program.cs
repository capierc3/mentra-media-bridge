using System.IO;
using System.Runtime.InteropServices;

namespace PcCaptionBridge;

// PC Caption Bridge: serves Windows Live Captions (and what's playing) in the
// same format as the TakeMotions Media Bridge Android app, so the Media Bridge
// Captions miniapp can show PC audio on the glasses.
//
// Runs in the system tray. `--console` runs it in a console window instead,
// printing captions as they come in.

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        bool console = args.Contains("--console") || args.Contains("--selftest") || args.Contains("--write-icon");
        if (console) AttachOrAllocConsole();

        if (args.Contains("--selftest")) return SelfTest.Run();
        if (args.Length == 2 && args[0] == "--write-icon") return WriteIco(args[1]);

        // Two copies would fight over the ports and the Live Captions window.
        using var single = new Mutex(true, @"Local\PcCaptionBridge", out bool first);
        if (!first)
        {
            const string msg = "PC Caption Bridge is already running. Look for the CC icon by the clock.";
            if (console) Console.WriteLine(msg);
            else MessageBox.Show(msg, "PC Caption Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        WindowHider.UsePhysicalPixels();

        var settings = AppSettings.Load();
        var bridge = new Bridge
        {
            HideWhileConnected = settings.HideWhileConnected && !args.Contains("--no-hide"),
        };
        bool launch = settings.LaunchLiveCaptions && !args.Contains("--no-launch");

        // Whatever happens, put Live Captions back on screen on the way out.
        AppDomain.CurrentDomain.ProcessExit += (_, _) => bridge.Stop();

        return console ? RunConsole(bridge, launch) : RunTray(bridge, settings, launch, args);
    }

    static int RunTray(Bridge bridge, AppSettings settings, bool launch, string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        FileLog.Start();
        bridge.Log += FileLog.Write;
        try
        {
            bridge.Start(launch);
        }
        catch (Exception e)
        {
            MessageBox.Show(
                $"Couldn't open ports {Bridge.CaptionPort} and {Bridge.MediaPort}: {e.Message}\n\n" +
                "Another program may be using them (for example adb forwarding Media Bridge from the phone).",
                "PC Caption Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Autostart.RefreshPath();
        Application.Run(new TrayApp(bridge, settings, showWelcome: !args.Contains(Autostart.Flag)));
        bridge.Stop();
        return 0;
    }

    static int RunConsole(Bridge bridge, bool launch)
    {
        bridge.Log += m => Console.WriteLine(m);
        bridge.CaptionLine += line => Console.WriteLine($"  > {line}");
        var signals = new[] { PosixSignal.SIGINT, PosixSignal.SIGTERM, PosixSignal.SIGHUP, PosixSignal.SIGQUIT }
            .Select(sig => PosixSignalRegistration.Create(sig, _ => bridge.Stop()))
            .ToList();

        Console.WriteLine("PC Caption Bridge");
        Console.WriteLine("=================");
        try
        {
            bridge.Start(launch);
        }
        catch (Exception e)
        {
            Console.WriteLine($"Couldn't open ports {Bridge.CaptionPort} and {Bridge.MediaPort}: {e.Message}");
            return 1;
        }

        Console.WriteLine();
        Console.WriteLine("Serving captions and now-playing info. In the miniapp, pick \"PC\" as the source");
        Console.WriteLine("and enter one of these addresses (phone and PC on the same Wi-Fi):");
        foreach (var (address, adapter) in Bridge.LanAddresses()) Console.WriteLine($"    {address}   ({adapter})");
        Console.WriteLine();
        Console.WriteLine("Or over USB: run `adb reverse tcp:8767 tcp:8767` and `adb reverse tcp:8766 tcp:8766`,");
        Console.WriteLine("then keep the source on \"Phone\" (turn off Media Bridge on the phone first).");
        Console.WriteLine();
        Console.WriteLine($"Test it here: http://localhost:{Bridge.CaptionPort}/caption");
        Console.WriteLine(bridge.HideWhileConnected
            ? "The Live Captions window moves off-screen while the glasses are connected, and comes back when they stop."
            : "Leaving the Live Captions window where it is.");
        Console.WriteLine("Press Ctrl+C to stop.");
        Console.WriteLine();

        Thread.Sleep(Timeout.Infinite);
        GC.KeepAlive(signals);
        return 0;
    }

    /// <summary>Writes the app icon (the tray badge) as a multi-size .ico. Used once to make icon.ico.</summary>
    static int WriteIco(string path)
    {
        int[] sizes = { 16, 20, 24, 32, 40, 48, 64, 256 };
        var pngs = sizes.Select(size =>
        {
            using var bmp = TrayIcons.Draw(TrayState.Waiting, size);
            using var ms = new MemoryStream();
            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return ms.ToArray();
        }).ToList();

        using var w = new BinaryWriter(File.Create(path));
        w.Write((short)0); // reserved
        w.Write((short)1); // icon
        w.Write((short)sizes.Length);
        int offset = 6 + 16 * sizes.Length;
        for (int i = 0; i < sizes.Length; i++)
        {
            w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
            w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
            w.Write((byte)0); // no palette
            w.Write((byte)0);
            w.Write((short)1); // planes
            w.Write((short)32); // bits per pixel
            w.Write(pngs[i].Length);
            w.Write(offset);
            offset += pngs[i].Length;
        }
        foreach (var png in pngs) w.Write(png);
        Console.WriteLine($"Wrote {path}");
        return 0;
    }

    /// <summary>
    /// This is a windowed (tray) program, so it has no console of its own. In
    /// console mode, use the terminal it was started from, or open a new one.
    /// </summary>
    static void AttachOrAllocConsole()
    {
        if (!AttachConsole(-1)) AllocConsole();
        var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
        Console.SetOut(stdout);
    }

    [DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);

    [DllImport("kernel32.dll")]
    static extern bool AllocConsole();
}
