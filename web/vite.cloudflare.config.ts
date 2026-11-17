import type { ConfigEnv, UserConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig, mergeConfig } from 'vite-plus'
import { createWorker } from './cloudflare.worker.ts'
import { cloudflareServerStubs } from './plugins/vite/cloudflare-server-stubs.ts'
import baseConfig from './vite.config.ts'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

// Cloudflare Workers build target (vinext POC). Kept out of vite.config.ts so unit tests,
// Storybook, and the Node vinext build never load the Cloudflare plugin.
// The plugin must be a top-level entry (not inside lazyPlugins()): vinext detects it from the
// raw config, and `vinext-cloudflare deploy` scans this file for a static `cloudflare(` call.
export default defineConfig(async (env: ConfigEnv) => {
  const base: UserConfig =
    typeof baseConfig === 'function' ? await baseConfig(env) : await baseConfig
  return mergeConfig(base, {
    plugins: [
      cloudflareServerStubs({ projectRoot }),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: (loaded) => ({ ...loaded, worker: createWorker() }),
      }),
    ],
  })
})
