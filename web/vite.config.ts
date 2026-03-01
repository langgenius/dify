import type { Plugin } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isCI = !!process.env.CI

export default defineConfig(({ mode }) => {
  return {
    plugins: mode === 'test'
      ? [
          tsconfigPaths(),
          react(),
          {
            // Stub .mdx files so components importing them can be unit-tested
            name: 'mdx-stub',
            enforce: 'pre',
            transform(_, id) {
              if (id.endsWith('.mdx'))
                return { code: 'export default () => null', map: null }
            },
          } as Plugin,
        ]
      : [
          vinext(),
        ],
    resolve: {
      alias: {
        '~@': __dirname,
      },
    },

    // vinext related config
    ...(mode !== 'test'
      ? {
          optimizeDeps: {
            exclude: ['nuqs'],
          },
          server: {
            port: 3000,
          },
        }
      : {}),

    // Vitest config
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
      },
    },
  }
})
