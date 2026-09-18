import type { Logger, Plugin } from 'vite'
import type { ModuleDependencies } from './i18n-analysis/routes'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizePath } from 'vite'
import { analyzeRouteNamespaces, validateRouteNamespaces } from './i18n-analysis/routes'

const SOURCE_META = 'dify:i18n-source'

// Vite shares these instances across client, SSR, and RSC environments. Each
// completed graph replaces its preceding scan build; only buildApp finalizes it.
export function i18nAnalysisPlugin(
  options: {
    getDeclaredNamespaces?: (route: string) => readonly string[] | undefined
  } = {},
): Plugin[] {
  let root: string
  let logger: Logger
  let reportPath: string | undefined
  let buildingApp = false
  const graphs = new Map<string, Map<string, string>>()
  const edges = new Map<string, Map<string, ModuleDependencies>>()
  const moduleId = (id: string) => normalizePath(id.split('?')[0]!)

  const check = async () => {
    const { checkTranslationGraph } = await import('./i18n-analysis/graph')
    const usage = new Map<string, Set<string>>()
    const dependencies = new Map<string, ModuleDependencies>()
    for (const graph of edges.values()) {
      for (const [id, imports] of graph) {
        const merged = dependencies.get(id) ?? {
          static: new Set<string>(),
          dynamic: new Set<string>(),
        }
        for (const dependency of imports.static) merged.static.add(dependency)
        for (const dependency of imports.dynamic) merged.dynamic.add(dependency)
        dependencies.set(id, merged)
      }
    }
    let unused: Record<string, string[]> | undefined
    const protectedNamespaces = new Set<string>()
    for (const graph of graphs.values()) {
      // Keep original paths in a separate compiler program per environment so
      // imports resolve against that environment's source, not the first build.
      const modules = new Map<string, string>()
      for (const [id, code] of graph) modules.set(normalizePath(id.split('?')[0]!), code)
      const result = checkTranslationGraph(root, modules)
      for (const [id, namespaces] of result.moduleNamespaces) {
        const merged = usage.get(id) ?? new Set<string>()
        for (const namespace of namespaces) merged.add(namespace)
        usage.set(id, merged)
      }
      for (const namespace of result.protectedNamespaces) protectedNamespaces.add(namespace)
      // Intersect unused sets: usage (or protection) in any environment keeps a key.
      unused =
        unused === undefined
          ? result.unused
          : Object.fromEntries(
              Object.entries(unused).map(([namespace, keys]) => {
                const remaining = new Set(result.unused[namespace] ?? [])
                return [namespace, keys.filter((key) => remaining.has(key))]
              }),
            )
    }
    const routes = analyzeRouteNamespaces(normalizePath(root), dependencies, usage)
    if (routes.length) {
      logger.info(
        [
          '[i18n] Route namespace analysis (static build graph; may overestimate or miss runtime usage):',
          'Includes ancestor boundaries, dynamic imports and all built parallel-slot branches. Interception segments remain in route labels.',
          ...routes.flatMap(({ route, page, namespaces, groups }) => [
            `  ${route} (${page}): ${namespaces.join(', ') || '(none detected)'}`,
            ...Object.entries(groups).map(
              ([name, entries]) =>
                `    ${name}: ${entries.map((entry) => entry.namespace).join(', ') || '(none detected)'}`,
            ),
          ]),
        ].join('\n'),
      )
    }
    if (routes.length && reportPath) {
      await fs.mkdir(path.dirname(reportPath), { recursive: true })
      await fs.writeFile(reportPath, `${JSON.stringify({ version: 1, routes }, null, 2)}\n`)
      logger.info(`[i18n] Full namespace sources: ${reportPath}`)
    }
    if (options.getDeclaredNamespaces)
      validateRouteNamespaces(routes, options.getDeclaredNamespaces)
    const keys = Object.entries(unused ?? {}).flatMap(([namespace, unused]) =>
      unused.map((key) => `${namespace}:${key}`),
    )
    if (keys.length) {
      throw new Error(
        [
          `Found ${keys.length} potentially unused i18n keys in the application build:`,
          'This report uses static analysis of the current build module graph and may contain false positives or miss unused keys.',
          'Review actual usage before removing any keys.',
          ...keys.map((key) => `  - ${key}`),
          'Remove confirmed unused keys from web/i18n/locales/ locale files or restore their application usage.',
          ...(protectedNamespaces.size
            ? [
                `Dynamic keys protect these namespaces: ${[...protectedNamespaces].sort().join(', ')}`,
              ]
            : []),
        ].join('\n'),
      )
    }
  }

  return [
    {
      name: 'i18n-analysis:collect',
      apply: 'build',
      enforce: 'pre',
      sharedDuringBuild: true,
      configResolved(config) {
        root = config.root
        logger = config.logger
        reportPath = config.build.write
          ? path.resolve(root, config.build.outDir, 'i18n-routes.json')
          : undefined
      },
      async buildApp() {
        graphs.clear()
        edges.clear()
        buildingApp = true
      },
      buildStart() {
        if (!buildingApp) {
          graphs.clear()
          edges.clear()
        }
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
        const dependencies = new Map<string, ModuleDependencies>()
        for (const id of this.getModuleIds()) {
          const info = this.getModuleInfo(id)
          if (info) {
            const imports = dependencies.get(moduleId(id)) ?? {
              static: new Set<string>(),
              dynamic: new Set<string>(),
            }
            for (const dependency of info.importedIds) imports.static.add(moduleId(dependency))
            for (const dependency of info.dynamicallyImportedIds)
              imports.dynamic.add(moduleId(dependency))
            dependencies.set(moduleId(id), imports)
          }
          const source: unknown = info?.meta[SOURCE_META]
          if (typeof source === 'string') graph.set(id, source)
        }
        graphs.set(this.environment.name, graph)
        edges.set(this.environment.name, dependencies)
        if (!buildingApp) await check()
      },
    },
    {
      name: 'i18n-analysis:check',
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
            edges.clear()
          }
        },
      },
    },
  ]
}
