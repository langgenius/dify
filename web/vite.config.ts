import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import vinext from 'vinext'
import { defineConfig } from 'vite'
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

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

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
          ...(isDev
            ? [
                createCodeInspectorPlugin(),
                createForceInspectorClientInjectionPlugin(),
              ]
            : []),
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
