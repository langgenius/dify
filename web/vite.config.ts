import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import vinext from 'vinext'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isCI = !!process.env.CI
const inspectorPort = 5678
const inspectorInjectTarget = path.resolve(__dirname, 'app/components/browser-initializer.tsx')
const inspectorRuntimeFile = path.resolve(
  __dirname,
  `node_modules/code-inspector-plugin/dist/append-code-${inspectorPort}.js`,
)

const getInspectorRuntimeSnippet = (): string => {
  if (!fs.existsSync(inspectorRuntimeFile))
    return ''

  const raw = fs.readFileSync(inspectorRuntimeFile, 'utf-8')
  // Remove the helper module default export from append file to avoid duplicate default exports.
  return raw.replace(
    /\s*export default function CodeInspectorEmptyElement\(\)\s*\{[\s\S]*$/,
    '',
  )
}

const normalizeInspectorModuleId = (id: string): string => {
  const withoutQuery = id.split('?', 1)[0]

  // Vite/vinext may pass absolute fs modules as "/@fs/<abs-path>".
  if (withoutQuery.startsWith('/@fs/'))
    return withoutQuery.slice('/@fs'.length)

  return withoutQuery
}

const createCodeInspectorPlugin = (): Plugin => {
  return codeInspectorPlugin({
    bundler: 'vite',
    port: inspectorPort,
    injectTo: inspectorInjectTarget,
    exclude: [/^(?!.*\.(?:js|ts|mjs|mts|jsx|tsx|vue|svelte|html)(?:$|\?)).*/],
  }) as Plugin
}

const createForceInspectorClientInjectionPlugin = (): Plugin => {
  const clientSnippet = getInspectorRuntimeSnippet()

  return {
    name: 'vinext-force-code-inspector-client',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (!clientSnippet)
        return null

      const cleanId = normalizeInspectorModuleId(id)
      if (cleanId !== inspectorInjectTarget)
        return null
      if (code.includes('code-inspector-component'))
        return null

      return `${clientSnippet}\n${code}`
    },
  }
}

function customI18nHmrPlugin(): Plugin {
  const injectTarget = inspectorInjectTarget
  const i18nHmrClientMarker = 'custom-i18n-hmr-client'
  const i18nHmrClientSnippet = `/* ${i18nHmrClientMarker} */
if (import.meta.hot) {
  const getI18nUpdateTarget = (file) => {
    const match = file.match(/[/\\\\]i18n[/\\\\]([^/\\\\]+)[/\\\\]([^/\\\\]+)\\.json$/)
    if (!match)
      return null
    const [, locale, namespaceFile] = match
    return { locale, namespaceFile }
  }

  import.meta.hot.on('i18n-update', async ({ file, content }) => {
    const target = getI18nUpdateTarget(file)
    if (!target)
      return

    const [{ getI18n }, { camelCase }] = await Promise.all([
      import('react-i18next'),
      import('es-toolkit/string'),
    ])

    const i18n = getI18n()
    if (!i18n)
      return
    if (target.locale !== i18n.language)
      return

    let resources
    try {
      resources = JSON.parse(content)
    }
    catch {
      return
    }

    const namespace = camelCase(target.namespaceFile)
    i18n.addResourceBundle(target.locale, namespace, resources, true, true)
    i18n.emit('languageChanged', i18n.language)
  })
}
`

  const injectI18nHmrClient = (code: string) => {
    if (code.includes(i18nHmrClientMarker))
      return code

    const useClientMatch = code.match(/(['"])use client\1;?\s*\n/)
    if (!useClientMatch)
      return `${i18nHmrClientSnippet}\n${code}`

    const insertAt = (useClientMatch.index ?? 0) + useClientMatch[0].length
    return `${code.slice(0, insertAt)}\n${i18nHmrClientSnippet}\n${code.slice(insertAt)}`
  }

  return {
    name: 'custom-i18n-hmr',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.json') && file.includes('/i18n/')) {
        server.ws.send({
          type: 'custom',
          event: 'i18n-update',
          data: {
            file,
            content: fs.readFileSync(file, 'utf-8'),
          },
        })

        // return empty array to prevent the default HMR
        return []
      }
    },
    transform(code, id) {
      const cleanId = normalizeInspectorModuleId(id)
      if (cleanId !== injectTarget)
        return null

      const nextCode = injectI18nHmrClient(code)
      if (nextCode === code)
        return null
      return { code: nextCode, map: null }
    },
  }
}

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'

  return {
    plugins: isTest
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
          Inspect(),
          createCodeInspectorPlugin(),
          createForceInspectorClientInjectionPlugin(),
          react(),
          vinext(),
          customI18nHmrPlugin(),
        ],
    resolve: {
      alias: {
        '~@': __dirname,
      },
    },

    // vinext related config
    ...(!isTest
      ? {
          optimizeDeps: {
            exclude: ['nuqs'],
            // Make Prism in lexical works
            // https://github.com/vitejs/rolldown-vite/issues/396
            rolldownOptions: {
              output: {
                strictExecutionOrder: true,
              },
            },
          },
          server: {
            port: 3000,
          },
          ssr: {
            // SyntaxError: Named export not found. The requested module is a CommonJS module, which may not support all module.exports as named exports
            noExternal: ['emoji-mart'],
          },
          // Make Prism in lexical works
          // https://github.com/vitejs/rolldown-vite/issues/396
          build: {
            rolldownOptions: {
              output: {
                strictExecutionOrder: true,
              },
            },
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
