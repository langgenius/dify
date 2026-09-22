import type { Logger, Plugin } from 'vite'
import type { TranslationAdapter } from './i18n-analysis/api'
import type { ModuleResolutions } from './i18n-analysis/compiler'
import type { AnalysisEvidence } from './i18n-analysis/graph'
import type {
  EnvironmentUsage,
  ModuleDependencies,
  ModuleLocation,
  RouteNamespaceReport,
} from './i18n-analysis/routes'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizePath } from 'vite'
import { analyzeEnvironmentRoutes, validateRouteNamespaces } from './i18n-analysis/routes'

const SOURCE_META = 'dify:i18n-source'

export type AnalysisReport = {
  version: 3
  routes: RouteNamespaceReport[]
  modules: ModuleLocation[]
  paths: [module: number, parent: number | null][]
  evidence: (AnalysisEvidence & { environment: string })[]
  metrics: {
    totalMs: number
    setupMs: number
    routesMs: number
    environments: {
      environment: string
      modules: number
      resolveCalls: number
      resolutionMs: number
      programMs: number
      analysisMs: number
    }[]
  }
}

// Vite shares these instances across client, SSR, and RSC environments. Each
// completed graph replaces its preceding scan build; only buildApp finalizes it.
export function i18nAnalysisPlugin(
  options: {
    adapters?: readonly TranslationAdapter[]
    onAnalysis?: (report: AnalysisReport) => void
    strictNamespaces?: boolean
    getDeclaredNamespaces?: (route: string) => readonly string[] | undefined
  } = {},
): Plugin[] {
  let root: string
  let logger: Logger
  let reportPath: string | undefined
  let buildingApp = false
  const graphs = new Map<
    string,
    {
      modules: Map<string, string>
      dependencies: Map<string, ModuleDependencies>
      resolutions: ModuleResolutions
      clientReferences: Set<string>
      resolveCalls: number
      resolutionMs: number
    }
  >()
  const moduleId = normalizePath
  const checks = new Map<string, Promise<void>>()
  const snapshots = new Map<string, string>()

  const check = async () => {
    const started = performance.now()
    const { checkTranslationGraph, createAnalysisContext } = await import('./i18n-analysis/graph')
    const context = createAnalysisContext(root, options.adapters)
    const setupMs = performance.now() - started
    const environments = new Map<string, EnvironmentUsage>()
    const evidence: AnalysisReport['evidence'] = []
    const metrics: AnalysisReport['metrics'] = {
      totalMs: 0,
      setupMs,
      routesMs: 0,
      environments: [],
    }
    let unused: Record<string, string[]> | undefined
    const protectedNamespaces = new Set<string>()
    for (const [environment, graph] of graphs) {
      const result = checkTranslationGraph(root, graph.modules, graph.resolutions, context)
      environments.set(environment, {
        dependencies: graph.dependencies,
        usage: result.moduleNamespaces,
        clientReferences: graph.clientReferences,
        unknownNamespaces: new Set(
          result.evidence
            .filter((item) => item.kind === 'unknown-namespace')
            .map((item) => item.moduleId),
        ),
      })
      evidence.push(...result.evidence.map((item) => ({ ...item, environment })))
      metrics.environments.push({
        environment,
        modules: graph.modules.size,
        resolveCalls: graph.resolveCalls,
        resolutionMs: graph.resolutionMs,
        ...result.timings,
      })
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
    const routesStarted = performance.now()
    const { routes, modules, paths } = analyzeEnvironmentRoutes(normalizePath(root), environments)
    metrics.routesMs = performance.now() - routesStarted
    metrics.totalMs =
      performance.now() -
      started +
      metrics.environments.reduce((sum, item) => sum + item.resolutionMs, 0)
    const report: AnalysisReport = { version: 3, routes, modules, paths, evidence, metrics }
    options.onAnalysis?.(report)
    logger.info(
      `[i18n] Analysis: ${metrics.totalMs.toFixed(0)}ms; ${metrics.environments.reduce((sum, item) => sum + item.modules, 0)} environment modules; ${metrics.environments.reduce((sum, item) => sum + item.resolveCalls, 0)} resolver calls.`,
    )
    const unresolved = evidence.filter((item) => item.kind === 'unresolved-import')
    if (unresolved.length) {
      const categories = new Map<string, number>()
      for (const item of unresolved) {
        const category = item.import?.kind ?? 'source'
        categories.set(category, (categories.get(category) ?? 0) + 1)
      }
      logger.warn(
        `[i18n] ${unresolved.length} runtime imports could not be traced (${[...categories].map(([kind, count]) => `${kind}: ${count}`).join(', ')}); inspect the report before trusting unused-key findings.`,
      )
    }
    const incomplete = routes.filter((route) => route.unknownNamespaceSources?.length)
    if (incomplete.length)
      logger.warn(
        `[i18n] Namespace analysis is incomplete for ${incomplete.length} routes; inspect unknownNamespaceSources before treating validation as complete.`,
      )
    const unknown = evidence.filter((item) => item.kind === 'unknown-namespace').length
    const dynamic = evidence.filter((item) => item.kind === 'dynamic-key').length
    logger.info(
      `[i18n] Routes: ${routes.length}; unknown namespace records: ${unknown}; dynamic key records: ${dynamic}; protected namespaces: ${[...protectedNamespaces].sort().join(', ') || '(none)'}.`,
    )
    if (reportPath) {
      await fs.mkdir(path.dirname(reportPath), { recursive: true })
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
      logger.info(`[i18n] Full namespace sources: ${reportPath}`)
    }
    if (options.getDeclaredNamespaces)
      validateRouteNamespaces(routes, options.getDeclaredNamespaces, options.strictNamespaces)
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
        checks.clear()
        snapshots.clear()
        buildingApp = true
      },
      buildStart() {
        if (this.meta.watchMode) {
          checks.delete(this.environment.name)
          snapshots.delete(this.environment.name)
        }
        if (!buildingApp && !snapshots.has(this.environment.name)) {
          graphs.clear()
        }
      },
      transform: {
        filter: {
          id: { include: /\.[cm]?[jt]sx?(?:\?.*)?$/, exclude: /(?:^\0|\/node_modules\/)/ },
        },
        handler(code, id) {
          if (!path.isAbsolute(id.split('?')[0]!)) return
          // Keep original source in cached metadata before TS/JSX/RSC transforms.
          return { code, map: null, meta: { [SOURCE_META]: code } }
        },
      },
      async buildEnd(error) {
        if (error) return
        const resolutionStarted = performance.now()
        const graph = new Map<string, string>()
        const compiledModules = new Map<string, string>()
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
          // Analyze the actual JSON module produced by Vite, never the raw disk file.
          if (id.endsWith('.json') && info?.code) {
            graph.set(moduleId(id), info.code)
            compiledModules.set(moduleId(id), info.code)
          }
          const source: unknown = info?.meta[SOURCE_META]
          if (typeof source === 'string') {
            graph.set(moduleId(id), source)
            compiledModules.set(moduleId(id), info?.code ?? '')
          }
        }
        // Rolldown may rebuild for another output format. Reuse only within
        // this open bundle and only when source, transforms and edges agree.
        const hash = createHash('sha256')
        for (const [id, imports] of [...dependencies].sort(([a], [b]) => a.localeCompare(b))) {
          hash.update(
            JSON.stringify([
              id,
              graph.get(id),
              compiledModules.get(id),
              [...imports.static].sort(),
              [...imports.dynamic].sort(),
            ]),
          )
        }
        const snapshot = hash.digest('hex')
        if (snapshots.get(this.environment.name) === snapshot) return
        checks.delete(this.environment.name)
        snapshots.set(this.environment.name, snapshot)
        const { hasClientDirective, resolveTranslationImports } =
          await import('./i18n-analysis/compiler')
        const clientReferences = new Set<string>()
        if (this.environment.name === 'rsc') {
          for (const [id, code] of graph) {
            if (!hasClientDirective(code)) continue
            clientReferences.add(id)
            graph.set(id, compiledModules.get(id) ?? '')
          }
        }
        const { resolutions, resolveCalls } = await resolveTranslationImports(
          graph,
          compiledModules,
          async (specifier, importer) => {
            const resolved = await this.resolve(specifier, importer)
            return resolved
              ? { id: moduleId(resolved.id), external: !!resolved.external }
              : undefined
          },
          (specifier) =>
            !specifier.includes('?') && this.environment.config.assetsInclude(specifier),
        )
        graphs.set(this.environment.name, {
          modules: graph,
          dependencies,
          resolutions,
          resolveCalls,
          resolutionMs: performance.now() - resolutionStarted,
          clientReferences,
        })
      },
      closeBundle() {
        snapshots.delete(this.environment.name)
        checks.delete(this.environment.name)
      },
      async generateBundle() {
        if (buildingApp) return
        let pending = checks.get(this.environment.name)
        if (!pending) {
          pending = check()
          checks.set(this.environment.name, pending)
        }
        await pending
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
          }
        },
      },
    },
  ]
}
