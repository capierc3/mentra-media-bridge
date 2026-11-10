# Media Bridge Captions (MentraOS miniapp)

Live captions on Even Realities G2 glasses for audio playing on your Android
phone: podcasts, audiobooks, video. It reads the caption feed from the
[TakeMotions Media Bridge](https://github.com/r-tkbyc/takemotions-media-bridge)
Android app and draws it on the glasses through MentraOS.

```
phone audio → Media Bridge (Android, on-device speech-to-text)
            → http://127.0.0.1:8767/caption
            → this miniapp (runs inside the Mentra app) → G2 display
```

## Setup

1. Install the Media Bridge APK on your Android phone (Android 12+), open it,
   and turn on **Captions**. Grant the screen-capture prompt.
2. Install [Bun](https://bun.sh), then in this folder:

   ```bash
   bun install
   bun dev
   ```

3. In the Mentra app: **Settings → Miniapp Developer Settings → Scan Miniapp
   QR Code**, and scan the QR code `bun dev` prints. Phone and PC must be on
   the same Wi-Fi. Or, with the phone plugged in over USB and `adb` installed, run
   `bun dev --usb`.

## Using it

- Captions start automatically. A short press on the glasses button pauses
  or resumes them.
- Open the miniapp on the phone for settings and diagnostics:
  - **Live**: shows words while they are still being recognized (least lag).
  - **Finished lines**: shows only finished 8-word lines (steadier, a few
    seconds behind).
  - Rows, characters per row, how often to check the bridge, and how often
    to redraw the glasses.
  - Diagnostics: connection status, last error, check time, redraw count,
    and a preview of exactly what is on the glasses.

## Project layout

| File | What it does |
|---|---|
| `src/background/index.ts` | Glasses logic: checks the bridge, limits redraw rate, draws text, handles the button, saves settings |
| `src/background/captions.ts` | Turns the bridge feed into wrapped rows (with tests in `captions.test.ts`) |
| `src/shared/channels.ts` | Settings, stats and the messages between background and phone screen |
| `src/ui/App.tsx` | Phone settings and diagnostics screen |
| `miniapp.json` | Manifest |

## Scripts

```bash
bun dev         # run on the phone with hot reload
bun test        # unit tests for the caption wrapping
bun run typecheck
bun run build
```

## Known limits

- Whether the Mentra app allows plain `http://127.0.0.1` requests from a
  miniapp is not documented. If the status says "Can't reach Media Bridge"
  while Media Bridge captions are on, check the error shown in Diagnostics.
- Phone calls can't be captured: Android doesn't allow playback capture of
  call audio.
- Media Bridge transcribes English only.
- The Mentra miniapp SDK is in beta (`@mentra/miniapp` 0.3.0-dev).
