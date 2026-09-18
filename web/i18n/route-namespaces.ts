import type { Namespace } from './resources'
import { namespaces } from './resources'

export const signInNamespaces = ['common', 'login'] as const satisfies readonly Namespace[]

// Unmigrated routes retain their complete namespace set. Keep this declaration
// shared by the server's initial selection and the client's navigation boundary.
export function getRouteNamespaces(pathname: string | null, basePath = ''): readonly Namespace[] {
  const route =
    basePath && pathname?.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname
  return route === '/signin' || route?.startsWith('/signin/') ? signInNamespaces : namespaces
}
