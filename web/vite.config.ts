import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isCI = !!process.env.CI
const browserInitializerInjectTarget = path.resolve(__dirname, 'app/components/browser-initializer.tsx')

const normalizeInspectorModuleId = (id: string): string => {
  const withoutQuery = id.split('?', 1)[0]

  // Vite/vinext may pass absolute fs modules as "/@fs/<abs-path>".
  if (withoutQuery.startsWith('/@fs/'))
    return withoutQuery.slice('/@fs'.length)

  return withoutQuery
}

const injectClientSnippet = (code: string, marker: string, snippet: string): string => {
  if (code.includes(marker))
    return code

  const useClientMatch = code.match(/(['"])use client\1;?\s*\n/)
  if (!useClientMatch)
    return `${snippet}\n${code}`

  const insertAt = (useClientMatch.index ?? 0) + useClientMatch[0].length
  return `${code.slice(0, insertAt)}\n${snippet}\n${code.slice(insertAt)}`
}

function customI18nHmrPlugin(): Plugin {
  const injectTarget = browserInitializerInjectTarget
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

      const nextCode = injectClientSnippet(code, i18nHmrClientMarker, i18nHmrClientSnippet)
      if (nextCode === code)
        return null
      return { code: nextCode, map: null }
    },
  }
}

function reactGrabOpenFilePlugin(): Plugin {
  const injectTarget = browserInitializerInjectTarget
  const reactGrabOpenFileClientMarker = 'react-grab-open-file-client'
  const reactGrabProjectRoot = __dirname
  const reactGrabOpenFileClientSnippet = `/* ${reactGrabOpenFileClientMarker} */
if (typeof window !== 'undefined') {
  const projectRoot = ${JSON.stringify(reactGrabProjectRoot)};
  const pluginName = 'dify-vite-open-file';
  const rootRelativeSourcePathPattern = /^\\/(?!@|node_modules)(?:.+)\\.(?:[cm]?[jt]sx?|mdx?)$/;

  const normalizeProjectRoot = (input) => {
    return input.endsWith('/') ? input.slice(0, -1) : input;
  };

  const resolveFilePath = (filePath) => {
    if (filePath.startsWith('/@fs/')) {
      return filePath.slice('/@fs'.length);
    }

    if (!rootRelativeSourcePathPattern.test(filePath)) {
      return filePath;
    }

    const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
    if (filePath.startsWith(normalizedProjectRoot)) {
      return filePath;
    }

    return \`\${normalizedProjectRoot}\${filePath}\`;
  };

  const registerPlugin = () => {
    if (window.__DIFY_REACT_GRAB_OPEN_FILE_PLUGIN_REGISTERED__) {
      return;
    }

    const reactGrab = window.__REACT_GRAB__;
    if (!reactGrab) {
      return;
    }

    reactGrab.registerPlugin({
      name: pluginName,
      hooks: {
        onOpenFile(filePath, lineNumber) {
          const params = new URLSearchParams({
            file: resolveFilePath(filePath),
            column: '1',
          });

          if (lineNumber) {
            params.set('line', String(lineNumber));
          }

          void fetch(\`/__open-in-editor?\${params.toString()}\`);
          return true;
        },
      },
    });

    window.__DIFY_REACT_GRAB_OPEN_FILE_PLUGIN_REGISTERED__ = true;
  };

  registerPlugin();
  window.addEventListener('react-grab:init', registerPlugin);
}
`

  return {
    name: 'react-grab-open-file',
    apply: 'serve',
    transform(code, id) {
      const cleanId = normalizeInspectorModuleId(id)
      if (cleanId !== injectTarget)
        return null

      const nextCode = injectClientSnippet(code, reactGrabOpenFileClientMarker, reactGrabOpenFileClientSnippet)
      if (nextCode === code)
        return null
      return { code: nextCode, map: null }
    },
  }
}

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'
  const isStorybook = process.env.STORYBOOK === 'true'
    || process.argv.some(arg => arg.toLowerCase().includes('storybook'))

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
      : isStorybook
        ? [
            tsconfigPaths(),
            react(),
          ]
        : [
            Inspect(),
            react(),
            vinext(),
            customI18nHmrPlugin(),
            reactGrabOpenFilePlugin(),
          ],
    resolve: {
      alias: {
        '~@': __dirname,
      },
    },

    // vinext related config
    ...(!isTest && !isStorybook
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
