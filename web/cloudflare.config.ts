import process from 'node:process'
import { bindings, defineConfig, defineWorker } from 'cf/config'

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

const textEnv = Object.fromEntries(
  Object.entries(process.env)
    .filter(
      ([key, value]) =>
        value !== undefined &&
        (key.startsWith('NEXT_PUBLIC_') || PASSTHROUGH_ENV_KEYS.includes(key)),
    )
    .map(([key, value]) => [key, bindings.text(value!)]),
)

// Run the Worker next to the AWS region that hosts the API, so SSR calls to the backend stay short.
// e.g. CF_PLACEMENT_REGION=aws:us-east-1
const placementRegion = process.env.CF_PLACEMENT_REGION

export default defineConfig({
  worker: defineWorker({
    name: process.env.CF_WORKER_NAME || 'dify-web',
    entrypoint: 'vinext/server/fetch-handler',
    compatibilityDate: '2026-11-17',
    compatibilityFlags: ['nodejs_compat'],
    placement: placementRegion ? { region: placementRegion } : { mode: 'smart' },
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
    },
    env: {
      ASSETS: bindings.assets(),
      WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET: bindings.secret(),
      ...textEnv,
    },
  }),
})
