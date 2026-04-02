import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import UnoCSS from 'unocss/vite'
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
const unoCssEntryTarget = `${projectRoot}app/layout.tsx`
const unoGlobalsCssTarget = `${projectRoot}app/styles/globals.css`

const injectUnoCssPlugin = {
  name: 'inject-uno-css-entry',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (id !== unoCssEntryTarget || code.includes('virtual:uno.css'))
      return

    return {
      code: `import 'virtual:uno.css'\n${code}`,
      map: null,
    }
  },
}

const stripUnoPreflightDirectivePlugin = {
  name: 'strip-uno-preflight-directive',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (id !== unoGlobalsCssTarget || !code.includes('@unocss !preflights;'))
      return

    return {
      code: code.replace('@unocss !preflights;', ''),
      map: null,
    }
  },
}

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'
  const isStorybook = process.env.STORYBOOK === 'true'
    || process.argv.some(arg => arg.toLowerCase().includes('storybook'))

  return {
    staged: {
      '*': 'eslint --fix --pass-on-unpruned-suppressions',
    },
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
            UnoCSS(),
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
            injectUnoCssPlugin,
            stripUnoPreflightDirectivePlugin,
            UnoCSS(),
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
    css: {
      postcss: {
        plugins: [
          autoprefixer(),
        ],
      },
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
      pool: 'threads',
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
      },
    },
  }
})
