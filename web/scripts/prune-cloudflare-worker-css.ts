/**
 * Removes CSS files from the Cloudflare Worker bundle after `vp build --config vite.cloudflare.config.ts`.
 *
 * The server builds emit the app's CSS into the Worker output, but no server module imports it.
 * The Worker only references those files as URLs, and the browser loads them from static assets.
 * The files are kept when any module does import CSS.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// The Build Output version directory (v0, v1, ...) changes with @cloudflare/vite-plugin.
const outputDir = path.resolve(import.meta.dirname, '../.cloudflare/output')
const outputVersion = fs.existsSync(outputDir)
  ? fs
      .readdirSync(outputDir)
      .filter((name) => /^v\d+$/.test(name))
      .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0]
  : undefined
const bundleDir = path.join(outputDir, outputVersion ?? 'v0', 'workers/default/bundle')

const CSS_IMPORT = /(?:from|import)\s*["'][^"']+\.css["']/

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
}

if (!fs.existsSync(bundleDir)) {
  console.error(`[prune-cloudflare-worker-css] ${bundleDir} not found. Run build:cloudflare first.`)
  process.exit(1)
}

const files = walk(bundleDir)
const cssImported = files.some(
  (file) => file.endsWith('.js') && CSS_IMPORT.test(fs.readFileSync(file, 'utf8')),
)
let cssCount = 0
let cssBytes = 0
if (!cssImported) {
  for (const file of files) {
    if (!file.endsWith('.css')) continue
    cssBytes += fs.statSync(file).size
    fs.rmSync(file)
    cssCount++
  }
}

console.log(
  `[prune-cloudflare-worker-css] removed ${cssCount} unimported CSS files (${(cssBytes / 1024 / 1024).toFixed(1)} MiB)`,
)
