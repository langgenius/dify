import path from 'node:path'

export type ModuleDependencies = { static: Set<string>; dynamic: Set<string> }
type NamespaceSources = { namespace: string; sources: string[] }
export type RouteNamespaceReport = {
  route: string
  page: string
  namespaces: string[]
  groups: Record<'page' | 'shared' | 'lazy' | 'slots', NamespaceSources[]>
}

export function validateRouteNamespaces(
  routes: readonly RouteNamespaceReport[],
  getDeclaredNamespaces: (route: string) => readonly string[] | undefined,
) {
  const violations: string[] = []
  for (const report of routes) {
    const declared = getDeclaredNamespaces(report.route)
    if (declared === undefined) continue
    const missing = report.namespaces.filter((namespace) => !declared.includes(namespace))
    if (!missing.length) continue
    violations.push(
      `  ${report.route} (${report.page})`,
      `    Declared: ${declared.join(', ') || '(none)'}`,
    )
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
): RouteNamespaceReport[] {
  const app = `${root.replaceAll('\\', '/')}/app/`
  const files = [...usage.keys()].filter((file) => file.startsWith(app))
  const boundaries = files.filter((file) =>
    /\/(?:layout|template|loading|error|not-found|global-error)\.[jt]sx?$/.test(file),
  )
  return files
    .filter((file) => /\/page\.[jt]sx?$/.test(file))
    .sort()
    .map((page) => {
      const segments = page.slice(app.length).split('/').slice(0, -1)
      const ancestors = new Set([app.slice(0, -1)])
      for (let i = 1; i <= segments.length; i++) ancestors.add(app + segments.slice(0, i).join('/'))
      const sharedEntries = boundaries.filter((file) => ancestors.has(path.posix.dirname(file)))
      const slotEntries: string[] = []
      // Parallel slots can retain previously active pages on navigation.
      for (const file of files) {
        const parts = file.slice(app.length).split('/')
        if (
          parts.some(
            (part, index) =>
              part.startsWith('@') &&
              ancestors.has(index ? app + parts.slice(0, index).join('/') : app.slice(0, -1)),
          )
        )
          slotEntries.push(file)
      }
      function reachable(entries: string[], includeDynamic: boolean) {
        const visited = new Set<string>()
        const pending = [...entries]
        while (pending.length) {
          const id = pending.pop()!
          if (visited.has(id)) continue
          visited.add(id)
          const imports = dependencies.get(id)
          for (const dependency of imports?.static ?? []) pending.push(dependency)
          if (includeDynamic)
            for (const dependency of imports?.dynamic ?? []) pending.push(dependency)
        }
        return visited
      }
      function sources(modules: Set<string>): NamespaceSources[] {
        const byNamespace = new Map<string, Set<string>>()
        for (const id of modules) {
          for (const namespace of usage.get(id) ?? []) {
            const files = byNamespace.get(namespace) ?? new Set<string>()
            files.add(path.posix.relative(root.replaceAll('\\', '/'), id))
            byNamespace.set(namespace, files)
          }
        }
        return [...byNamespace]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([namespace, files]) => ({
            namespace,
            sources: [...files].sort(),
          }))
      }
      const pageModules = reachable([page], false)
      const sharedModules = reachable(sharedEntries, false)
      const mainModules = reachable([page, ...sharedEntries], true)
      const lazyModules = new Set(
        [...mainModules].filter((id) => !pageModules.has(id) && !sharedModules.has(id)),
      )
      const slotModules = new Set(
        [...reachable(slotEntries, true)].filter((id) => !mainModules.has(id)),
      )
      const groups = {
        page: sources(pageModules),
        shared: sources(sharedModules),
        lazy: sources(lazyModules),
        slots: sources(slotModules),
      }
      const namespaces = new Set(
        Object.values(groups).flatMap((group) => group.map((item) => item.namespace)),
      )
      return {
        // Keep interception segments visible; their URL depends on navigation.
        route: `/${segments.filter((segment) => !/^\([^)]*\)$/.test(segment) && !segment.startsWith('@')).join('/')}`,
        page: page.slice(root.replaceAll('\\', '/').length + 1),
        namespaces: [...namespaces].sort(),
        groups,
      }
    })
}
