import fs from 'node:fs'
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

  // Serve public/ straight from Workers Static Assets (free) instead of invoking the Worker
  // (billed per request). proxy.ts only adds CSP and frame headers there, which do nothing for
  // images and scripts; public/ holds no HTML documents.
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const publicDir = fileURLToPath(new URL('./public', import.meta.url))
  const publicRoutes = fs
    .readdirSync(publicDir, { withFileTypes: true })
    .map((entry) => `!${basePath}/${entry.name}${entry.isDirectory() ? '/*' : ''}`)

  // Run the Worker next to the AWS region that hosts the API, so SSR calls to the backend stay short.
  // e.g. CF_PLACEMENT_REGION=aws:us-east-1
  const placementRegion = process.env.CF_PLACEMENT_REGION

  return defineWorker({
    name: process.env.CF_WORKER_NAME || 'dify-web',
    entrypoint: 'vinext/server/fetch-handler',
    compatibilityDate: '2026-11-17',
    compatibilityFlags: ['nodejs_compat'],
    placement: placementRegion ? { region: placementRegion } : { mode: 'smart' },
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
