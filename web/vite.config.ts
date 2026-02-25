import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import { defineConfig, loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const isCI = !!process.env.CI

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const vinextFontGoogleShimPath = fs.realpathSync(path.resolve(__dirname, 'node_modules/vinext/dist/shims/font-google.js'))

function vinextGoogleFontExportPatch(): Plugin {
  return {
    name: 'vinext:google-font-export-patch',
    enforce: 'pre',
    load(id) {
      if (id.includes('?vinext-font-proxy'))
        return null

      const [resolvedId] = id.split('?', 1)
      if (resolvedId !== vinextFontGoogleShimPath)
        return null

      const shimWithQuery = `${vinextFontGoogleShimPath}?vinext-font-proxy`
      return `
import googleFonts from ${JSON.stringify(shimWithQuery)}
export { default } from ${JSON.stringify(shimWithQuery)}
export * from ${JSON.stringify(shimWithQuery)}
export const Instrument_Serif = (options = {}) => googleFonts.Instrument_Serif(options)
`
    },
  }
}

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
            vinextGoogleFontExportPatch(),
            vinext(),
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
