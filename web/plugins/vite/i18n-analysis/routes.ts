import path from 'node:path'

export type ModuleDependencies = { static: Set<string>; dynamic: Set<string> }
export type ModuleLocation = { environment: string; moduleId: string }
type NamespaceSources = {
  namespace: string
  sources: string[]
  dependencyPaths?: number[]
}
export type RouteNamespaceReport = {
  route: string
  page: string
  namespaces: string[]
  unknownNamespaceSources?: string[]
  groups: Record<'page' | 'shared' | 'lazy' | 'slots', NamespaceSources[]>
}

export function validateRouteNamespaces(
  routes: readonly RouteNamespaceReport[],
  getDeclaredNamespaces: (route: string) => readonly string[] | undefined,
  strictNamespaces = false,
) {
  const violations: string[] = []
  for (const report of routes) {
    const declared = getDeclaredNamespaces(report.route)
    if (declared === undefined) continue
    const missing = report.namespaces.filter((namespace) => !declared.includes(namespace))
    const unknown = strictNamespaces ? (report.unknownNamespaceSources ?? []) : []
    if (!missing.length && !unknown.length) continue
    violations.push(
      `  ${report.route} (${report.page})`,
      `    Declared: ${declared.join(', ') || '(none)'}`,
    )
    for (const source of unknown) violations.push(`    Cannot verify namespace usage: ${source}`)
    for (const namespace of missing) {
      violations.push(`    Undeclared namespace: ${namespace}`)
      for (const [group, entries] of Object.entries(report.groups)) {
        for (const source of entries.find((entry) => entry.namespace === namespace)?.sources ?? [])
          violations.push(`      [${group}] ${source}`)
      }
    }
  }
  if (violations.length) {
    throw new Error(
      [
        'Route namespace declarations do not cover statically detected usage:',
        ...violations,
        'Remove the dependency or update the route namespace declaration after reviewing its usage.',
        'Includes shared boundaries, dynamic imports and conservative parallel-slot additions; inspect the reported sources before changing declarations.',
      ].join('\n'),
    )
  }
}

// Use resolved build edges (including virtual modules), not an independent
// resolver which could disagree with aliases, exports or environment conditions.
export function analyzeRouteNamespaces(
  root: string,
  dependencies: ReadonlyMap<string, ModuleDependencies>,
  usage: ReadonlyMap<string, ReadonlySet<string>>,
  options: {
    sourcePath?: (id: string) => string
    entries?: ReadonlySet<string>
    unknownNamespaces?: ReadonlySet<string>
    recordPath?: (id: string, parent: number | null) => number
  } = {},
): RouteNamespaceReport[] {
  const sourcePath = (id: string) => (options.sourcePath?.(id) ?? id).split('?')[0]!
  const app = `${root.replaceAll('\\', '/')}/app/`
  const files = [...usage.keys()].filter(
    (file) => sourcePath(file).startsWith(app) && (!options.entries || options.entries.has(file)),
  )
  const boundaries = files.filter((file) =>
    /\/(?:layout|template|loading|error|not-found|global-error)\.[jt]sx?$/.test(sourcePath(file)),
  )
  const reachability = new Map<
    string,
    { modules: Set<string>; parents: Map<string, string | null> }
  >()
  return files
    .filter((file) => /\/page\.[jt]sx?$/.test(sourcePath(file)))
    .sort()
    .map((page) => {
      const segments = sourcePath(page).slice(app.length).split('/').slice(0, -1)
      const route = `/${segments.filter((segment) => !/^\([^)]*\)$/.test(segment) && !segment.startsWith('@')).join('/')}`
      const ancestors = new Set([app.slice(0, -1)])
      for (let i = 1; i <= segments.length; i++) ancestors.add(app + segments.slice(0, i).join('/'))
      const sharedEntries = boundaries.filter((file) =>
        ancestors.has(path.posix.dirname(sourcePath(file))),
      )
      const slotEntries: string[] = []
      // Parallel slots can retain previously active pages on navigation.
      for (const file of files) {
        const parts = sourcePath(file).slice(app.length).split('/')
        if (
          parts.some(
            (part, index) =>
              part.startsWith('@') &&
              ancestors.has(index ? app + parts.slice(0, index).join('/') : app.slice(0, -1)),
          )
        )
          slotEntries.push(file)
      }
      function reachable(entries: string[], includeDynamic: boolean, cache = false) {
        const key = JSON.stringify([includeDynamic, [...entries].sort()])
        const cached = cache && reachability.get(key)
        if (cached) return cached
        const visited = new Set<string>()
        const pending = [...entries]
        const parents = new Map<string, string | null>(entries.map((id) => [id, null]))
        for (let cursor = 0; cursor < pending.length; cursor++) {
          const id = pending[cursor]!
          if (visited.has(id)) continue
          visited.add(id)
          const imports = dependencies.get(id)
          for (const dependency of [
            ...(imports?.static ?? []),
            ...(includeDynamic ? (imports?.dynamic ?? []) : []),
          ]) {
            if (parents.has(dependency)) continue
            parents.set(dependency, id)
            pending.push(dependency)
          }
        }
        const result = { modules: visited, parents }
        if (cache) reachability.set(key, result)
        return result
      }
      function sources(
        modules: Set<string>,
        parents: Map<string, string | null>,
      ): NamespaceSources[] {
        const paths = new Map<string, Set<number>>()
        const recorded = new Map<string, number>()
        function recordPath(id: string): number {
          const existing = recorded.get(id)
          if (existing !== undefined) return existing
          const parent = parents.get(id)
          const index = options.recordPath!(id, parent ? recordPath(parent) : null)
          recorded.set(id, index)
          return index
        }
        const byNamespace = new Map<string, Set<string>>()
        for (const id of modules) {
          for (const namespace of usage.get(id) ?? []) {
            const files = byNamespace.get(namespace) ?? new Set<string>()
            files.add(path.posix.relative(root.replaceAll('\\', '/'), sourcePath(id)))
            byNamespace.set(namespace, files)
            if (options.recordPath) {
              const entries = paths.get(namespace) ?? new Set<number>()
              entries.add(recordPath(id))
              paths.set(namespace, entries)
            }
          }
        }
        return [...byNamespace]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([namespace, files]) => ({
            namespace,
            sources: [...files].sort(),
            ...(options.recordPath ? { dependencyPaths: [...(paths.get(namespace) ?? [])] } : {}),
          }))
      }
      const pageModules = reachable([page], false)
      const sharedModules = reachable(sharedEntries, false, true)
      const mainModules = reachable([page, ...sharedEntries], true)
      const lazyModules = new Set(
        [...mainModules.modules].filter(
          (id) => !pageModules.modules.has(id) && !sharedModules.modules.has(id),
        ),
      )
      const slots = reachable(slotEntries, true, true)
      const slotModules = new Set([...slots.modules].filter((id) => !mainModules.modules.has(id)))
      const groups = {
        page: sources(pageModules.modules, pageModules.parents),
        shared: sources(sharedModules.modules, sharedModules.parents),
        lazy: sources(lazyModules, mainModules.parents),
        slots: sources(slotModules, slots.parents),
      }
      const namespaces = new Set(
        Object.values(groups).flatMap((group) => group.map((item) => item.namespace)),
      )
      return {
        // Keep interception segments visible; their URL depends on navigation.
        route,
        page: sourcePath(page).slice(root.replaceAll('\\', '/').length + 1),
        namespaces: [...namespaces].sort(),
        groups,
        ...(options.unknownNamespaces
          ? {
              unknownNamespaceSources: [
                ...new Set(
                  [...mainModules.modules, ...slotModules]
                    .filter((id) => options.unknownNamespaces!.has(id))
                    .map((id) => path.posix.relative(root.replaceAll('\\', '/'), sourcePath(id))),
                ),
              ].sort(),
            }
          : {}),
      }
    })
}

export type EnvironmentUsage = {
  dependencies: ReadonlyMap<string, ModuleDependencies>
  usage: ReadonlyMap<string, ReadonlySet<string>>
  clientReferences: ReadonlySet<string>
  unknownNamespaces?: ReadonlySet<string>
}

export function analyzeEnvironmentRoutes(
  root: string,
  environments: ReadonlyMap<string, EnvironmentUsage>,
) {
  const modules: ModuleLocation[] = []
  const moduleIndexes = new Map<string, number>()
  const paths: [module: number, parent: number | null][] = []
  const pathIndexes = new Map<string, number>()
  function recordPath(id: string, parent: number | null) {
    let module = moduleIndexes.get(id)
    if (module === undefined) {
      const [environment, moduleId] = JSON.parse(id) as [string, string]
      module = modules.length
      modules.push({ environment, moduleId })
      moduleIndexes.set(id, module)
    }
    const key = `${module}:${parent}`
    let index = pathIndexes.get(key)
    if (index === undefined) {
      index = paths.length
      paths.push([module, parent])
      pathIndexes.set(key, index)
    }
    return index
  }
  const key = (environment: string, id: string) => JSON.stringify([environment, id])
  const sourcePaths = new Map<string, string>()
  const dependencies = new Map<string, ModuleDependencies>()
  const usage = new Map<string, ReadonlySet<string>>()
  const unknownNamespaces = new Set<string>()
  for (const [environment, graph] of environments) {
    for (const id of graph.unknownNamespaces ?? []) unknownNamespaces.add(key(environment, id))
    for (const [id, namespaces] of graph.usage) {
      const identity = key(environment, id)
      usage.set(identity, namespaces)
      sourcePaths.set(identity, id)
    }
    for (const [id, edges] of graph.dependencies) {
      const identity = key(environment, id)
      sourcePaths.set(identity, id)
      const imports = {
        static: new Set([...edges.static].map((id) => key(environment, id))),
        dynamic: new Set([...edges.dynamic].map((id) => key(environment, id))),
      }
      // RSC imports a client reference stub. Only this explicit boundary may
      // cross into the corresponding SSR and browser implementations.
      if (environment === 'rsc' && graph.clientReferences.has(id)) {
        for (const target of ['ssr', 'client']) {
          if (environments.get(target)?.usage.has(id)) imports.static.add(key(target, id))
        }
      }
      dependencies.set(identity, imports)
    }
  }
  const reports = new Map<string, RouteNamespaceReport>()
  for (const [environment, graph] of environments) {
    const entries = new Set([...graph.usage.keys()].map((id) => key(environment, id)))
    for (const report of analyzeRouteNamespaces(root, dependencies, usage, {
      entries,
      sourcePath: (id) => sourcePaths.get(id) ?? id,
      recordPath,
      unknownNamespaces,
    })) {
      const previous = reports.get(report.page)
      if (!previous) {
        reports.set(report.page, report)
        continue
      }
      previous.unknownNamespaceSources = [
        ...new Set([
          ...(previous.unknownNamespaceSources ?? []),
          ...(report.unknownNamespaceSources ?? []),
        ]),
      ].sort()
      previous.namespaces = [...new Set([...previous.namespaces, ...report.namespaces])].sort()
      for (const group of ['page', 'shared', 'lazy', 'slots'] as const) {
        const byNamespace = new Map<string, Set<string>>()
        const paths = new Map<string, Set<number>>()
        for (const item of [...previous.groups[group], ...report.groups[group]]) {
          const chains = paths.get(item.namespace) ?? new Set<number>()
          for (const chain of item.dependencyPaths ?? []) chains.add(chain)
          paths.set(item.namespace, chains)
          const sources = byNamespace.get(item.namespace) ?? new Set<string>()
          for (const source of item.sources) sources.add(source)
          byNamespace.set(item.namespace, sources)
        }
        previous.groups[group] = [...byNamespace]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([namespace, sources]) => ({
            namespace,
            sources: [...sources].sort(),
            dependencyPaths: [...(paths.get(namespace) ?? [])],
          }))
      }
    }
  }
  return {
    routes: [...reports.values()].sort((a, b) => a.page.localeCompare(b.page)),
    modules,
    paths,
  }
}
