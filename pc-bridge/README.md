# PC Caption Bridge (Windows)

Shows captions for audio playing on a Windows 11 PC on the G2 glasses, through
the Media Bridge Captions miniapp. It reads the text from Windows' built-in
**Live Captions** and serves it in the same format as the Media Bridge
Android app, so the miniapp works the same way with either source.

```
PC audio → Windows Live Captions (Win+Ctrl+L)
         → PC Caption Bridge reads its text (UI Automation, every 200 ms)
         → http://<pc>:8767/caption   captions
           http://<pc>:8766/media     what's playing (Windows media controls)
         → miniapp on the phone (Source: PC) → G2
```

Needs Windows 11 22H2 or newer (for Live Captions) and the
[.NET 10 runtime](https://dotnet.microsoft.com/download/dotnet/10.0).

## Download

Get **PcCaptionBridge.exe** from the
[latest release](https://github.com/capierc3/mentra-media-bridge/releases/latest)
and double-click it. Windows SmartScreen may warn because it isn't signed:
choose **More info → Run anyway**. If the .NET 10 Desktop Runtime is missing,
Windows offers to download it.

## Build it yourself

Build the app (one .exe):

```bash
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
```

Then double-click `publish\PcCaptionBridge.exe`. It runs in the **system
tray**: look for the **CC** icon by the clock (it may be under the ^ arrow;
drag it onto the taskbar to keep it visible). It opens Live Captions if it
isn't already open.

Windows Firewall asks whether to allow it the first time: allow it on
**Private** networks. Your Wi-Fi must be set to Private in Windows, not
Public.

Then in the miniapp on the phone: **Source → PC**, and enter the PC address
from the tray menu.

### The tray icon

| Icon | Meaning |
|---|---|
| CC | Running, glasses not connected |
| CC with a green dot | Glasses connected |
| CC with an orange dot | Live Captions is closed |
| Grey CC with pause bars | Paused |

Click it (left or right) for the menu:

- **PC address**: click it to copy (a submenu if the PC has more than one).
- **Pause captions / Resume captions**: while paused, nothing is shared, the
  glasses show "Captions paused on the PC", and Live Captions stays on
  screen.
- **Hide Live Captions while connected**: see below. On by default.
- **Open Live Captions**: shown when it's closed.
- **Start with Windows**: starts in the tray when you sign in (quietly, with
  no welcome popup). Stored under `HKCU\...\Run`, so it points at the exe
  you turned it on from. If you move the exe, start it once from the new
  place.
- **Open log**: connection events, in Notepad.
- **Quit**: stops sharing and puts Live Captions back on screen.

Only one copy runs at a time. Settings and the log are in
`%LOCALAPPDATA%\PcCaptionBridge`.

### Console mode

For testing, `PcCaptionBridge.exe --console` (or `dotnet run -- --console`)
runs in a console window instead and prints captions as they arrive. Stop it
with Ctrl+C.

Check it from the PC: <http://localhost:8767/caption>

### Live Captions window while the glasses are connected

While the miniapp is checking for captions, the bridge moves the Live
Captions window off-screen (just past the right edge of your monitors), so it
isn't on the PC screen too. Live Captions keeps captioning there. When the
miniapp stops checking for 5 seconds (paused, phone asleep or away, or source
switched back to Phone), the window goes back to where it was.

It also goes back when you quit from the tray menu, sign out, or press
Ctrl+C in console mode. If the bridge is killed outright (Task Manager, or
closing the console window), the window stays off-screen until the next
start, which puts it back first thing. Closing and reopening Live Captions
also brings it back on screen: it opens on a monitor, not where it was left.

Turn off **Hide Live Captions while connected** in the tray menu (or use
`--no-hide`) to leave the window alone. Tested with the floating Live
Captions window. Docked to the top or bottom of the screen isn't tested: the
docked strip may keep its space on screen even when the window moves away.

### Over USB instead of Wi-Fi

With the phone plugged in and `adb` installed:

```bash
adb reverse tcp:8767 tcp:8767
```

```bash
adb reverse tcp:8766 tcp:8766
```

Leave the miniapp's source on **Phone**. Turn off captions in the phone's
Media Bridge app first, because it uses the same ports.

## Options

| Flag | What it does |
|---|---|
| `--console` | Run in a console window instead of the tray |
| `--no-launch` | Don't open Live Captions on start |
| `--no-hide` | Don't move the Live Captions window off-screen (this run only) |
| `--selftest` | Run the caption-tracking checks and exit |

## How it works

Live Captions has no API for other programs, but its window can be read
through UI Automation, the interface screen readers use. All of its text is
in one element (automation ID `CaptionsTextBlock`).

That text is one rolling block: Live Captions keeps rewriting the last
sentence and drops old text off the front as it scrolls. `CaptionTracker.cs`
turns it into Media Bridge's format:

- Every sentence except the last becomes a numbered line with a time stamp.
- The last sentence is the `partial` (words still being recognized).
- A sentence already sent out is matched against what's on screen, so
  scrolling doesn't send it again. If Live Captions fixes up one of the
  newest lines, that line is updated in place.
- A last sentence that ends in `.`, `!` or `?` and stays unchanged for 1.5 s
  becomes a line too, so "Finished lines" mode doesn't wait forever when
  speech stops.

Now-playing info comes from Windows' media controls, the same info as the
volume flyout. Apps that don't report a timeline (some browsers) show no time
bar.

## Files

| File | What it does |
|---|---|
| `Program.cs` | Start-up: tray or console mode, one copy at a time |
| `Bridge.cs` | Read loop, JSON for both endpoints, connected/paused state |
| `TrayApp.cs` | Tray icon and menu |
| `TrayIcons.cs` | Draws the CC icon in each state (also makes `icon.ico`) |
| `AppSettings.cs` | Saved settings, Start with Windows, log file |
| `LiveCaptionsReader.cs` | Finds the Live Captions window and reads its text |
| `CaptionTracker.cs` | Rolling text → lines + partial |
| `MediaReader.cs` | Now playing from Windows media controls |
| `WindowHider.cs` | Moves the Live Captions window off-screen and back |
| `TinyHttpServer.cs` | Small JSON server (no admin rights needed, unlike HttpListener) |
| `SelfTest.cs` | Checks for `CaptionTracker` |

## Known limits

- Live Captions has to stay open. Off-screen is fine (tested). Minimized
  hasn't been tested.
- Language is whatever Live Captions is set to (Live Captions settings →
  Change language).
- It reads the screen text, so a Windows update that renames the element
  would break it. Then `/caption` reports `"status": "stopped"` even with
  Live Captions open.
