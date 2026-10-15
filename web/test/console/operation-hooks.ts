import type * as ReactQuery from '@tanstack/react-query'

type OperationOptions = { queryKey?: unknown; mutationKey?: unknown }
type OperationHandler = (options: never) => unknown
export type OperationRoutes = Partial<Record<string, OperationHandler>>

// Console operation keys start with ['console', ...path]; routes use the dotted path.
const getOperationPath = (key: unknown) => {
  if (!Array.isArray(key) || !Array.isArray(key[0])) return undefined
  const [prefix, ...path] = key[0] as string[]
  return prefix === 'console' ? path.join('.') : undefined
}

const route = (routes: OperationRoutes, key: unknown, options: OperationOptions) => {
  const path = getOperationPath(key)
  const handler = path ? routes[path] : undefined
  return handler ? { handled: true, value: handler(options as never) } : { handled: false }
}

/**
 * Builds a `@tanstack/react-query` module mock that answers console operations from
 * `routes` and leaves every other query to the real hooks.
 *
 * vi.mock('@tanstack/react-query', async (importOriginal) =>
 *   (await import('@/test/console/operation-hooks')).mockConsoleOperationHooks(
 *     await importOriginal(),
 *     { 'workspaces.current.members.get': () => mockMembersResult() },
 *   ))
 */
export const mockConsoleOperationHooks = (actual: typeof ReactQuery, routes: OperationRoutes) => ({
  ...actual,
  useQuery: ((options: OperationOptions) => {
    const result = route(routes, options.queryKey, options)
    return result.handled ? result.value : actual.useQuery(options as never)
  }) as typeof actual.useQuery,
  useInfiniteQuery: ((options: OperationOptions) => {
    const result = route(routes, options.queryKey, options)
    return result.handled ? result.value : actual.useInfiniteQuery(options as never)
  }) as typeof actual.useInfiniteQuery,
  useMutation: ((options: OperationOptions) => {
    const result = route(routes, options.mutationKey, options)
    return result.handled ? result.value : actual.useMutation(options as never)
  }) as typeof actual.useMutation,
})
