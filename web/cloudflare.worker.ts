import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { bindings, defineWorker } from 'cf/config'

// POC: forward the same env the Docker image receives at runtime into Worker vars.
// Undeclared vars are removed on deploy, so every runtime setting must be listed here.
const PASSTHROUGH_ENV_KEYS = [
  'CONSOLE_API_URL',
  'SERVER_CONSOLE_API_URL',
  'INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH',
  'TEXT_GENERATION_TIMEOUT_MS',
  'WEBAPP_ACCESS_PREFLIGHT_URL',
  'WORKFLOW_GENERATION_TIMEOUT_MS',
]

const appDir = fileURLToPath(new URL('./app', import.meta.url))
const publicDir = fileURLToPath(new URL('./public', import.meta.url))

// First URL segments the App Router can serve. Route groups `(name)` and parallel slots
// `@name` add no segment, so their children count as top-level too.
function appTopLevelSegments(dir = appDir, found = { names: new Set<string>(), dynamic: false }) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    if (entry.name.startsWith('(') || entry.name.startsWith('@'))
      appTopLevelSegments(path.join(dir, entry.name), found)
    else if (entry.name.startsWith('[')) found.dynamic = true
    else found.names.add(entry.name)
  }
  return found
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(file) : [file]
  })
}

// Serve public/ straight from Workers Static Assets (free) instead of invoking the Worker
// (billed per request). proxy.ts only adds CSP and frame headers there, which do nothing for
// images and scripts; public/ holds no HTML documents.
// Negative run_worker_first rules win over `/*`, so a directory rule such as `!/education/*`
// would also hide the /education pages from the Worker. Directories that share their name with a
// route are therefore excluded file by file.
// With a basePath the build puts _next/static under the prefix but public/ at the asset root, so
// /base/embed.js has no matching asset path, and `assets.basePath` would strip the prefix from
// _next/static too. The Worker maps those requests itself, so they keep going through it.
function staticPublicRoutes(basePath: string) {
  if (basePath) return []
  const routes = appTopLevelSegments()
  return fs.readdirSync(publicDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [`!/${entry.name}`]
    if (!routes.dynamic && !routes.names.has(entry.name)) return [`!/${entry.name}/*`]
    return listFiles(path.join(publicDir, entry.name)).map(
      (file) => `!/${path.relative(publicDir, file).split(path.sep).join('/')}`,
    )
  })
}

// Not named cloudflare.config.ts on purpose: vinext treats that file as "this project builds for
// Cloudflare" and fails the default Node build (Dockerfile, bundle-size CI) without the plugin.
// vite.cloudflare.config.ts injects this Worker through the plugin's `config` hook instead.
// Built lazily: vinext loads .env files into process.env after this module is imported.
export function createWorker() {
  const textEnv = Object.fromEntries(
    Object.entries(process.env)
      .filter(
        ([key, value]) =>
          value !== undefined &&
          (key.startsWith('NEXT_PUBLIC_') || PASSTHROUGH_ENV_KEYS.includes(key)),
      )
      .map(([key, value]) => [key, bindings.text(value!)]),
  )

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const publicRoutes = staticPublicRoutes(basePath)

  // Run the Worker next to the AWS region that hosts the API, so SSR calls to the backend stay short.
  // e.g. CF_PLACEMENT_REGION=aws:us-east-1
  const placementRegion = process.env.CF_PLACEMENT_REGION

  return defineWorker({
    name: process.env.CF_WORKER_NAME || 'dify-web',
    entrypoint: 'vinext/server/fetch-handler',
    compatibilityDate: '2026-11-17',
    compatibilityFlags: ['nodejs_compat'],
    placement: placementRegion ? { region: placementRegion } : { mode: 'smart' },
    // Invocation logs carry per-request CPU and wall time, which the cost estimate depends on.
    observability: { enabled: true },
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*', ...publicRoutes],
    },
    env: {
      ASSETS: bindings.assets(),
      WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET: bindings.secret(),
      ...textEnv,
    },
  })
}
