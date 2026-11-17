/**
 * Shrinks the Cloudflare Worker bundle after `vp build --config vite.cloudflare.config.ts`.
 *
 * vinext builds the rsc and ssr environments separately, and both ship the same i18n chunks
 * and asset manifests. Rewriting each duplicate ssr module as a re-export of its rsc twin
 * saves about 17 MiB of the Worker's 64 MiB upload limit. Only leaf modules are shared: a module
 * that imports nothing holds data or self-contained code, so a single instance behaves the same
 * for both environments. A module with imports keeps its own copy, because sharing it could merge
 * state that must stay per environment.
 *
 * CSS files that no module imports are dropped too. The Worker only references them as URLs,
 * and the browser loads them from static assets.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const bundleDir = path.resolve(
  import.meta.dirname,
  '../.cloudflare/output/v0/workers/default/bundle',
)
const ssrDir = path.join(bundleDir, 'ssr')

const MODULE_IMPORT =
  /(?:\bimport\s*\{[^}]*\}\s*from\s*|\bimport\s+[\w$]+\s+from\s*|\bimport\s*\*\s*as\s+[\w$]+\s+from\s*|\bexport\s*\*\s*from\s*|\bexport\s*\{[^}]*\}\s*from\s*|\bimport\s*\(\s*|\bimport\s*)["'](?:\.{1,2}\/|node:|cloudflare:|[a-z@])/
const TRAILING_EXPORTS = /export\s*\{([^}]*)\};?(?:\s*\/\/# sourceMappingURL=\S+)?\s*$/
const CSS_IMPORT = /(?:from|import)\s*["'][^"']+\.css["']/

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
}

function exportedNames(code: string): string[] | undefined {
  if (/^\s*export default\b/.test(code) && !/\bexport\s*[{*]/.test(code)) return ['default']
  const match = TRAILING_EXPORTS.exec(code)
  if (!match) return undefined
  return match[1]!
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) =>
      specifier
        .split(/\s+as\s+/)
        .at(-1)!
        .trim(),
    )
}

function toImportPath(from: string, to: string) {
  const relative = path.relative(path.dirname(from), to).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

if (!fs.existsSync(ssrDir)) {
  console.error(`[slim-cloudflare-worker] ${ssrDir} not found. Run build:cloudflare first.`)
  process.exit(1)
}

const files = walk(bundleDir)
let sharedCount = 0
let sharedBytes = 0
for (const file of files) {
  if (!file.startsWith(ssrDir + path.sep) || !file.endsWith('.js')) continue
  const twin = path.join(bundleDir, path.relative(ssrDir, file))
  if (!fs.existsSync(twin)) continue
  const code = fs.readFileSync(file, 'utf8')
  if (code !== fs.readFileSync(twin, 'utf8') || MODULE_IMPORT.test(code)) continue
  const names = exportedNames(code)
  if (!names?.length) continue
  const source = JSON.stringify(toImportPath(file, twin))
  fs.writeFileSync(file, `export { ${names.join(', ')} } from ${source}\n`)
  fs.rmSync(`${file}.map`, { force: true })
  sharedCount++
  sharedBytes += Buffer.byteLength(code)
}

const scripts = files.filter((file) => file.endsWith('.js') && fs.existsSync(file))
const cssImported = scripts.some((file) => CSS_IMPORT.test(fs.readFileSync(file, 'utf8')))
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

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
console.log(
  `[slim-cloudflare-worker] shared ${sharedCount} ssr modules with rsc (${mib(sharedBytes)} MiB), removed ${cssCount} unimported CSS files (${mib(cssBytes)} MiB)`,
)
