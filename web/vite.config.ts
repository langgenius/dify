import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import Inspect from 'vite-plugin-inspect'
import { defineConfig } from 'vite-plus'
import { createCodeInspectorPlugin, createForceInspectorClientInjectionPlugin } from './plugins/vite/code-inspector'
import { customI18nHmrPlugin } from './plugins/vite/custom-i18n-hmr'
import { getRootClientInjectTarget } from './plugins/vite/inject-target'
import { nextStaticImageTestPlugin } from './plugins/vite/next-static-image-test'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const isCI = !!process.env.CI
const rootClientInjectTarget = getRootClientInjectTarget(projectRoot)

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'
  const isStorybook = process.env.STORYBOOK === 'true'
    || process.argv.some(arg => arg.toLowerCase().includes('storybook'))

  return {
    plugins: isTest
      ? [
          nextStaticImageTestPlugin({ projectRoot }),
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
              injectTarget: rootClientInjectTarget,
            }),
            createForceInspectorClientInjectionPlugin({
              injectTarget: rootClientInjectTarget,
              projectRoot,
            }),
            react(),
            vinext({ react: false }),
            customI18nHmrPlugin({ injectTarget: rootClientInjectTarget }),
            // reactGrabOpenFilePlugin({
            //   injectTarget: rootClientInjectTarget,
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
      coverage: {
        provider: 'v8',
        reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
      },
    },
  }
})
