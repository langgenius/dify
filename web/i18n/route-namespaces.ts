import type { Namespace } from './resources'
import { namespaces } from './resources'

type RouteNamespaceDeclaration = {
  // Resources loaded by the server and on client navigation.
  preloadNamespaces: readonly Namespace[]
  // Complete permitted usage, including dynamic imports and parallel slots.
  // Allowing a namespace does not load it; features must load deferred resources.
  allowedNamespaces: readonly Namespace[]
}

// More specific declarations override an ancestor declaration.
const routeNamespaceDeclarations: Readonly<Record<string, RouteNamespaceDeclaration>> = {
  '/signin': {
    preloadNamespaces: ['common', 'login'],
    allowedNamespaces: ['common', 'login'],
  },
}
const declaredRoutes = Object.keys(routeNamespaceDeclarations).sort((a, b) => b.length - a.length)

function getRouteNamespaceDeclaration(
  pathname: string | null,
  basePath = '',
): RouteNamespaceDeclaration | undefined {
  const route =
    basePath && pathname?.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname
  const declaredRoute = declaredRoutes.find(
    (path) => route === path || route?.startsWith(`${path}/`),
  )
  return declaredRoute ? routeNamespaceDeclarations[declaredRoute] : undefined
}

export function getAllowedRouteNamespaces(pathname: string | null, basePath = '') {
  return getRouteNamespaceDeclaration(pathname, basePath)?.allowedNamespaces
}

export function getDeclaredRoutePreloadNamespaces(pathname: string | null, basePath = '') {
  return getRouteNamespaceDeclaration(pathname, basePath)?.preloadNamespaces
}

// Unmigrated routes retain their complete namespace set.
export function getRouteNamespaces(pathname: string | null, basePath = ''): readonly Namespace[] {
  return getDeclaredRoutePreloadNamespaces(pathname, basePath) ?? namespaces
}
