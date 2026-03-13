/// <reference types="vitest/config" />

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import { createCodeInspectorPlugin, createForceInspectorClientInjectionPlugin } from './plugins/vite/code-inspector'
import { customI18nHmrPlugin } from './plugins/vite/custom-i18n-hmr'
import { EXCLUDED_COMPONENT_MODULES } from './scripts/components-coverage-thresholds.mjs'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const isCI = !!process.env.CI
const coverageScope = process.env.VITEST_COVERAGE_SCOPE
const browserInitializerInjectTarget = path.resolve(projectRoot, 'app/components/browser-initializer.tsx')
const excludedAppComponentsCoveragePaths = [...EXCLUDED_COMPONENT_MODULES]
  .map(moduleName => `app/components/${moduleName}/**`)

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'
  const isStorybook = process.env.STORYBOOK === 'true'
    || process.argv.some(arg => arg.toLowerCase().includes('storybook'))
  const isAppComponentsCoverage = coverageScope === 'app-components'

  return {
    plugins: isTest
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
          },
        ]
      : isStorybook
        ? [
            react(),
          ]
        : [
            Inspect(),
            createCodeInspectorPlugin({
              injectTarget: browserInitializerInjectTarget,
            }),
            createForceInspectorClientInjectionPlugin({
              injectTarget: browserInitializerInjectTarget,
              projectRoot,
            }),
            react(),
            vinext({ react: false }),
            customI18nHmrPlugin({ injectTarget: browserInitializerInjectTarget }),
            // reactGrabOpenFilePlugin({
            //   injectTarget: browserInitializerInjectTarget,
            //   projectRoot,
            // }),
          ],
    resolve: {
      tsconfigPaths: true,
    },

    // vinext related config
    ...(!isTest && !isStorybook
      ? {
          optimizeDeps: {
            exclude: ['@tanstack/react-query'],
          },
          server: {
            port: 3000,
          },
          ssr: {
            // SyntaxError: Named export not found. The requested module is a CommonJS module, which may not support all module.exports as named exports
            noExternal: ['emoji-mart'],
          },
        }
      : {}),

    // Vitest config
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      reporters: ['agent'],
      coverage: {
        provider: 'v8',
        reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
        ...(isAppComponentsCoverage
          ? {
              include: ['app/components/**/*.{ts,tsx}'],
              exclude: [
                'app/components/**/*.d.ts',
                'app/components/**/*.spec.{ts,tsx}',
                'app/components/**/*.test.{ts,tsx}',
                'app/components/**/__tests__/**',
                'app/components/**/__mocks__/**',
                'app/components/**/*.stories.{ts,tsx}',
                ...excludedAppComponentsCoveragePaths,
              ],
            }
          : {}),
      },
    },
  }
})
