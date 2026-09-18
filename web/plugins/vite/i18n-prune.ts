import type { Plugin } from 'vite'
import path from 'node:path'
import { normalizePath } from 'vite'

const SOURCE_META = 'dify:i18n-source'

// Vite shares these instances across client, SSR, and RSC environments. Each
// completed graph replaces its preceding scan build; only buildApp finalizes it.
export function i18nPrunePlugin(): Plugin[] {
  let root: string
  let buildingApp = false
  const graphs = new Map<string, Map<string, string>>()

  const check = async () => {
    const { checkTranslationGraph } = await import('./i18n-prune/graph')
    const modules = new Map<string, string>()
    for (const graph of graphs.values()) {
      for (const [id, code] of graph) {
        const file = normalizePath(id.split('?')[0]!)
        const previous = modules.get(file)
        if (previous !== undefined && previous !== code) {
          // Keep environment/query variants in the same directory so their
          // relative type imports resolve without discarding another usage set.
          const extension = path.extname(file)
          modules.set(
            `${file.slice(0, -extension.length)}.__i18n_${modules.size}${extension}`,
            code,
          )
        } else {
          modules.set(file, code)
        }
      }
    }
    const result = checkTranslationGraph(root, modules)
    const keys = Object.entries(result.unused).flatMap(([namespace, unused]) =>
      unused.map((key) => `${namespace}:${key}`),
    )
    if (keys.length) {
      throw new Error(
        [
          `Found ${keys.length} potentially unused i18n keys in the application build:`,
          'This report uses static analysis of the current build module graph and may contain false positives or miss unused keys.',
          'Review actual usage before removing any keys.',
          ...keys.map((key) => `  - ${key}`),
          'Remove confirmed unused keys from web/i18n/ locale files or restore their application usage.',
          ...(result.protectedNamespaces.length
            ? [`Dynamic keys protect these namespaces: ${result.protectedNamespaces.join(', ')}`]
            : []),
        ].join('\n'),
      )
    }
  }

  return [
    {
      name: 'i18n-prune:collect',
      apply: 'build',
      enforce: 'pre',
      sharedDuringBuild: true,
      configResolved(config) {
        root = config.root
      },
      async buildApp() {
        graphs.clear()
        buildingApp = true
      },
      buildStart() {
        if (!buildingApp) graphs.clear()
      },
      transform(code, id) {
        const file = normalizePath(id.split('?')[0]!)
        if (
          id.startsWith('\0') ||
          !path.isAbsolute(file) ||
          file.includes('/node_modules/') ||
          !/\.[cm]?[jt]sx?$/.test(file)
        )
          return
        // Persist the original source in module metadata, including cached modules
        // on rebuilds, before JSX/TypeScript and RSC transforms discard selectors.
        return { code, map: null, meta: { [SOURCE_META]: code } }
      },
      async generateBundle() {
        const graph = new Map<string, string>()
        for (const id of this.getModuleIds()) {
          const source: unknown = this.getModuleInfo(id)?.meta[SOURCE_META]
          if (typeof source === 'string') graph.set(id, source)
        }
        graphs.set(this.environment.name, graph)
        if (!buildingApp) await check()
      },
    },
    {
      name: 'i18n-prune:check',
      apply: 'build',
      sharedDuringBuild: true,
      buildApp: {
        order: 'post',
        async handler(builder) {
          try {
            // Vite's default environment loop runs after post hooks. Vinext
            // builds earlier; plain Vite needs its default loop completed here.
            if (Object.values(builder.environments).every((environment) => !environment.isBuilt)) {
              for (const environment of Object.values(builder.environments))
                await builder.build(environment)
            }
            await check()
          } finally {
            buildingApp = false
            graphs.clear()
          }
        },
      },
    },
  ]
}
