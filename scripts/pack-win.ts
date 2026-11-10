/**
 * Windows stand-in for `mentra-miniapp pack`.
 *
 * The Mentra CLI zips dist/ by running a `zip` program, which Windows doesn't
 * have. This does the same steps using the `tar.exe` that ships with Windows 10+
 * (it can write .zip files):
 *
 *   1. run the production build (build.ts)
 *   2. copy miniapp.json and icon.png into dist/
 *   3. zip dist/'s contents into build/<packageName>-<version>.zip
 *
 * `mentra-miniapp release` then finds that zip, sees it's newer than every
 * source file, and serves it instead of trying to pack again.
 */

import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "fs"
import {join, resolve} from "path"

const root = resolve(import.meta.dir, "..")
const dist = join(root, "dist")
const outDir = join(root, "build")

async function run(cmd: string[], cwd = root) {
  const proc = Bun.spawn(cmd, {cwd, stdout: "inherit", stderr: "inherit"})
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed with exit code ${code}`)
}

const manifest = JSON.parse(readFileSync(join(root, "miniapp.json"), "utf-8"))
const zipName = `${manifest.packageName}-${manifest.version}.zip`
const zipPath = join(outDir, zipName)

// 1. Build
await run([process.execPath, "run", "build.ts"])

// 2. Manifest and icon go inside the bundle
copyFileSync(join(root, "miniapp.json"), join(dist, "miniapp.json"))
if (existsSync(join(root, "icon.png"))) copyFileSync(join(root, "icon.png"), join(dist, "icon.png"))

for (const [label, rel] of Object.entries(manifest.entry ?? {})) {
  if (typeof rel === "string" && !existsSync(join(dist, rel))) {
    throw new Error(`manifest entry.${label} points at "${rel}" but dist/${rel} does not exist`)
  }
}

// 3. Zip. Listing the top-level entries (rather than ".") keeps paths like
// "background/index.js" without a leading "./".
mkdirSync(outDir, {recursive: true})
if (!existsSync(join(outDir, ".gitignore"))) writeFileSync(join(outDir, ".gitignore"), "*\n")
rmSync(zipPath, {force: true})
const entries = readdirSync(dist)
// Full path, so Git Bash's GNU tar (which can't write zips) isn't picked up instead.
const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
await run([winTar, "-a", "-c", "-f", zipPath, "-C", dist, ...entries])

console.log(`Packed ${zipName}`)
