import type { ConfigEnv, UserConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig, mergeConfig } from 'vite-plus'
import { createWorker } from './cloudflare.worker.ts'
import { cloudflareServerStubs } from './plugins/vite/cloudflare-server-stubs.ts'
import { dedupeNestedSsrOutput } from './plugins/vite/dedupe-nested-ssr-output.ts'
import baseConfig from './vite.config.ts'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

// Cloudflare Workers build target (vinext POC). Kept out of vite.config.ts so unit tests,
// Storybook, and the Node vinext build never load the Cloudflare plugin.
// The plugin must be a top-level entry (not inside lazyPlugins()): vinext detects it from the
// raw config before lazy plugins resolve.
export default defineConfig(async (env: ConfigEnv) => {
  const base: UserConfig =
    typeof baseConfig === 'function' ? await baseConfig(env) : await baseConfig
  return mergeConfig(base, {
    // @cloudflare/vite-plugin emits Worker source maps unless build.sourcemap is set. `cf deploy`
    // uploads them with the modules, and at about 66 MiB the upload fails with
    // "[10021] multipart: message too large". The client build has none either.
    build: { sourcemap: false },
    plugins: [
      cloudflareServerStubs({ projectRoot }),
      dedupeNestedSsrOutput(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: (loaded) => ({ ...loaded, worker: createWorker() }),
      }),
    ],
  })
})
