import type { Plugin } from 'vite'
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import { defineConfig, loadEnv } from 'vite'
import mkcert from 'vite-plugin-mkcert'
import tsconfigPaths from 'vite-tsconfig-paths'

const isCI = !!process.env.CI

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      ...(mode === 'test'
        ? [
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
            mdx(),
            vinext(),
            mkcert(),
          ]),
      tsconfigPaths(),
    ],
    resolve: {
      alias: {
        '~@': __dirname,
      },
    },
    optimizeDeps: {
      exclude: ['nuqs'],
    },
    server: {
      port: 3000,
    },
    envPrefix: 'NEXT_PUBLIC_',
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
      },
    },
    define: {
      'process.env': env,
    },
  }
})
