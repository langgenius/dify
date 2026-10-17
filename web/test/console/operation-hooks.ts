import type { OperationKeyOptions, OperationType } from '@orpc/tanstack-query'
import type * as ReactQuery from '@tanstack/react-query'
import { generateOperationKey } from '@orpc/tanstack-query'

// Must match the `prefix` passed to createTanstackQueryUtils in service/console/query-policies.ts.
const CONSOLE_KEY_PREFIX = 'console'

/**
 * Builds the key the console query utilities produce for a dotted operation path,
 * using oRPC's own key generator so tests never spell out its key layout.
 *
 * consoleOperationKey('account.profile.get', { type: 'query' })
 *   // equals consoleQuery.account.profile.get.queryKey()
 */
export const consoleOperationKey = <TType extends OperationType, TInput = unknown>(
  path: string,
  options: Omit<OperationKeyOptions<TType, TInput>, 'prefix'> = {},
) => generateOperationKey(path.split('.'), { ...options, prefix: CONSOLE_KEY_PREFIX })

/** Same as `consoleQuery.<path>.queryKey({ input })`. */
export const consoleQueryKey = (path: string, input?: unknown) =>
  consoleOperationKey<'query', unknown>(path, { type: 'query', input })

// Locate the prefix, path and options slots from a key oRPC generates itself.
const keyLayout: readonly unknown[] = generateOperationKey(['path'], { prefix: CONSOLE_KEY_PREFIX })
const prefixIndex = keyLayout.indexOf(CONSOLE_KEY_PREFIX)
const pathIndex = keyLayout.findIndex(Array.isArray)
const optionsIndex = keyLayout.findIndex(
  (part) => typeof part === 'object' && part !== null && !Array.isArray(part),
)

const isConsoleOperationKey = (key: unknown): key is readonly unknown[] =>
  Array.isArray(key) &&
  key.length === keyLayout.length &&
  key[prefixIndex] === CONSOLE_KEY_PREFIX &&
  Array.isArray(key[pathIndex])

/** Dotted operation path of a console query or mutation key, e.g. `'account.profile.get'`. */
export const getOperationPath = (key: unknown) =>
  isConsoleOperationKey(key) ? (key[pathIndex] as string[]).join('.') : undefined

/** The `input` a console operation key was generated with. */
export const getOperationInput = <TInput>(key: unknown) =>
  isConsoleOperationKey(key)
    ? (key[optionsIndex] as { input?: TInput } | undefined)?.input
    : undefined

type OperationOptions = { queryKey?: unknown; mutationKey?: unknown }
type OperationHandler = (options: never, input: never) => unknown
export type OperationRoutes = Partial<Record<string, OperationHandler>>

const route = (routes: OperationRoutes, key: unknown, options: OperationOptions) => {
  const path = getOperationPath(key)
  const handler = path ? routes[path] : undefined
  return handler
    ? { handled: true, value: handler(options as never, getOperationInput(key) as never) }
    : { handled: false }
}

/**
 * Builds a `@tanstack/react-query` module mock that answers console operations from
 * `routes` and leaves every other query to the real hooks. Each handler receives the
 * hook options and the operation input.
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
 * module, producing the same keys the real utilities use.
 */
export const consoleOperationStub = (path: string) => {
  const queryKey = (options?: { input?: unknown }) => consoleQueryKey(path, options?.input)
  return {
    key: () => consoleOperationKey(path),
    queryKey,
    queryOptions: (options: { input?: unknown } = {}) => ({
      ...options,
      queryKey: queryKey(options),
    }),
    mutationOptions: (options: object = {}) => ({
      ...options,
      mutationKey: consoleOperationKey(path, { type: 'mutation' }),
    }),
  }
}
