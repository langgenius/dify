import type { Namespace } from './resources'
import { namespaces } from './resources'

// Opt in route subtrees only after auditing their complete namespace usage.
// More specific declarations override an ancestor declaration.
const routeNamespaceDeclarations: Readonly<Record<string, readonly Namespace[]>> = {
  '/signin': ['common', 'login'],
}
const declaredRoutes = Object.keys(routeNamespaceDeclarations).sort((a, b) => b.length - a.length)

export function getDeclaredRouteNamespaces(
  pathname: string | null,
  basePath = '',
): readonly Namespace[] | undefined {
  const route =
    basePath && pathname?.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname
  const declaredRoute = declaredRoutes.find(
    (path) => route === path || route?.startsWith(`${path}/`),
  )
  return declaredRoute ? routeNamespaceDeclarations[declaredRoute] : undefined
}

// Unmigrated routes retain their complete namespace set.
export function getRouteNamespaces(pathname: string | null, basePath = ''): readonly Namespace[] {
  return getDeclaredRouteNamespaces(pathname, basePath) ?? namespaces
}
