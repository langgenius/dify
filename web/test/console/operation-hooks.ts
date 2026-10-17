import type { OperationKey } from '@orpc/tanstack-query'
import type * as ReactQuery from '@tanstack/react-query'

/** The `['console', path, options]` query key the console query utilities produce. */
export type ConsoleOperationKey<TInput> = Extract<
  OperationKey<'query', TInput>,
  [string, string[], unknown]
>

type OperationOptions = { queryKey?: unknown; mutationKey?: unknown }
type OperationHandler = (options: never) => unknown
export type OperationRoutes = Partial<Record<string, OperationHandler>>

// Console operation keys start with ['console', path]; routes use the dotted path.
const getOperationPath = (key: unknown) => {
  if (!Array.isArray(key) || key[0] !== 'console' || !Array.isArray(key[1])) return undefined
  return (key[1] as string[]).join('.')
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

/**
 * Stands in for one console operation inside a fully mocked `@/service/console`
 * module, producing the same key shape the real utilities use.
 */
export const consoleOperationStub = (path: string) => {
  const segments = path.split('.')
  const queryKey = (options?: { input?: unknown }) =>
    ['console', segments, { type: 'query', input: options?.input }] as const
  return {
    key: () => ['console', segments, {}] as const,
    queryKey,
    queryOptions: (options: { input?: unknown } = {}) => ({
      ...options,
      queryKey: queryKey(options),
    }),
    mutationOptions: (options: object = {}) => ({
      ...options,
      mutationKey: ['console', segments, { type: 'mutation' }],
    }),
  }
}
