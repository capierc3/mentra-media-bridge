/**
 * Builds the GitHub Pages install site in docs/.
 *
 * The Mentra app installs a release from any web address that serves the same
 * four files `mentra-miniapp release` serves on your LAN:
 *
 *   /miniapp.json                 manifest
 *   /icon.png                     icon
 *   /bundle.zip                   the app
 *   /__mentra_release/health      {"ok":true}
 *
 * So we copy those into docs/ (GitHub Pages serves that folder) plus an
 * index.html with the install QR code and link.
 *
 * Usage: bun run scripts/publish-pages.ts https://<user>.github.io/<repo>
 * Run `bun run pack:win` (or `bun run pack`) first so build/ has a fresh zip.
 */

import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "fs"
import {join, resolve} from "path"
import QRCode from "qrcode"

const root = resolve(import.meta.dir, "..")
const docs = join(root, "docs")

const baseUrl = (process.argv[2] ?? "").replace(/\/+$/, "")
if (!/^https:\/\/[^/]+\.github\.io\/[^/]+$/.test(baseUrl)) {
  console.error("Usage: bun run scripts/publish-pages.ts https://<user>.github.io/<repo>")
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(root, "miniapp.json"), "utf-8"))
const {packageName, version, name, description} = manifest as Record<string, string>
const zip = join(root, "build", `${packageName}-${version}.zip`)
if (!existsSync(zip)) {
  console.error(`Missing ${zip}. Run "bun run pack:win" first.`)
  process.exit(1)
}

// https://<user>.github.io/<repo> → https://github.com/<user>/<repo>
const [, ghUser, ghRepo] = baseUrl.match(/^https:\/\/([^.]+)\.github\.io\/(.+)$/)!
const repoUrl = `https://github.com/${ghUser}/${ghRepo}`

const installUrl =
  `miniapp://release?url=${encodeURIComponent(baseUrl)}` +
  `&package=${encodeURIComponent(packageName)}` +
  `&version=${encodeURIComponent(version)}` +
  `&name=${encodeURIComponent(name)}`

// Fresh docs/ every time.
rmSync(docs, {recursive: true, force: true})
mkdirSync(join(docs, "__mentra_release"), {recursive: true})

copyFileSync(zip, join(docs, "bundle.zip"))
copyFileSync(join(root, "miniapp.json"), join(docs, "miniapp.json"))
if (existsSync(join(root, "icon.png"))) copyFileSync(join(root, "icon.png"), join(docs, "icon.png"))
writeFileSync(join(docs, "__mentra_release", "health"), JSON.stringify({ok: true}))
// Without this, GitHub Pages' Jekyll step skips folders starting with "_".
writeFileSync(join(docs, ".nojekyll"), "")

const qrSvg = await QRCode.toString(installUrl, {type: "svg", margin: 2, errorCorrectionLevel: "M"})
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

writeFileSync(
  join(docs, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f4f5; --card:#fff; --text:#18181b; --muted:#52525b; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0b0b; --card:#18181b; --text:#f4f4f5; --muted:#a1a1aa; --accent:#4a9eff; } }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:560px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:1.6rem; margin:0 0 4px; }
  .muted { color:var(--muted); }
  .card { background:var(--card); border-radius:14px; padding:16px; margin:16px 0; }
  .qr { background:#fff; border-radius:12px; padding:8px; max-width:320px; margin:12px auto; }
  .qr svg { display:block; width:100%; height:auto; }
  a.button { display:block; text-align:center; background:var(--accent); color:#fff; text-decoration:none; padding:12px; border-radius:10px; font-weight:600; }
  ol, ul { padding-left:1.2em; } li { margin:6px 0; }
  code { font-size:.9em; }
</style>
</head>
<body>
<main>
  <h1>${esc(name)}</h1>
  <p class="muted">${esc(description ?? "")} Version ${esc(version)}.</p>

  <div class="card">
    <strong>Install on your phone</strong>
    <ol>
      <li>In the Mentra app: <b>Settings → Developer settings</b>.</li>
      <li>Under "Mini App Development", tap <b>Scan Mini App QR Code</b> and scan this code.</li>
    </ol>
    <div class="qr">${qrSvg}</div>
    <p class="muted">Already on your phone? Try the link instead:</p>
    <a class="button" href="${esc(installUrl)}">Install in Mentra</a>
  </div>

  <div class="card">
    <strong>You also need</strong>
    <ol>
      <li>Display glasses connected to the Mentra app (built for Even Realities G2).</li>
      <li>A caption source. Pick it in the miniapp under <b>Source</b>:
        <ul>
          <li><b>Phone</b>: audio playing on an Android 12+ phone, through the
            <a href="https://github.com/r-tkbyc/takemotions-media-bridge">TakeMotions Media Bridge</a> app.
            Turn on <b>Captions</b>, and <b>Enable media bridge</b> for track info and time.</li>
          <li><b>PC</b>: audio playing on a Windows 11 PC, through Windows Live Captions and
            <a href="${esc(repoUrl)}/tree/main/pc-bridge">PC Caption Bridge</a> (a tray app on the PC).
            Enter the PC address from its tray menu. Phone and PC on the same Wi-Fi.</li>
        </ul>
      </li>
    </ol>
  </div>
</main>
</body>
</html>
`,
)

console.log(`docs/ ready for ${baseUrl}`)
console.log(installUrl)
