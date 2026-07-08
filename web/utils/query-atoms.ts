import type { DefaultError, QueryClient, QueryKey } from '@tanstack/react-query'
import type { Getter, WritableAtom } from 'jotai'
import type {
  AtomWithQueryOptions,
  AtomWithQueryResult,
  AtomWithSuspenseQueryOptions,
  AtomWithSuspenseQueryResult,
  DefinedInitialDataOptions,
  UndefinedInitialDataOptions,
} from 'jotai-tanstack-query'
import { atom } from 'jotai'
import { atomWithQuery, atomWithSuspenseQuery } from 'jotai-tanstack-query'

type PrefetchedQueryResult<TResult extends { data: unknown }> = TResult extends unknown
  ? Omit<TResult, 'data'> & {
    data: Exclude<TResult['data'], undefined>
  }
  : never

type PrefetchedAtomWithQueryResult<TData, TError = DefaultError> = PrefetchedQueryResult<
  AtomWithQueryResult<TData, TError>
>

type ResolvedAtomWithSuspenseQueryResult<TData, TError = DefaultError> = Awaited<
  AtomWithSuspenseQueryResult<TData, TError>
>

/**
 * Creates an atomWithQuery-compatible atom for data that is required at read time.
 *
 * Use this only when the same query has been prefetched or hydrated before any
 * consumer reads the atom. It preserves the full query result shape, but narrows
 * `data` to a non-undefined value after a runtime invariant check.
 *
 * This helper does not fetch, wait, suspend, or provide fallback data. If the
 * cache is missing, the QueryClient is recreated, the query key changes, or the
 * query legitimately returns undefined, reading the atom throws. Use plain
 * atomWithQuery for normal loading states.
 */
export function atomWithPrefetchedQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  getOptions: (get: Getter) => UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  getQueryClient?: (get: Getter) => QueryClient,
): WritableAtom<PrefetchedAtomWithQueryResult<TData, TError>, [], void>
export function atomWithPrefetchedQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  getOptions: (get: Getter) => DefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  getQueryClient?: (get: Getter) => QueryClient,
): WritableAtom<PrefetchedAtomWithQueryResult<TData, TError>, [], void>
export function atomWithPrefetchedQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  getOptions: (get: Getter) => AtomWithQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  getQueryClient?: (get: Getter) => QueryClient,
): WritableAtom<PrefetchedAtomWithQueryResult<TData, TError>, [], void>
export function atomWithPrefetchedQuery(
  getOptions: (get: Getter) => AtomWithQueryOptions,
  getQueryClient?: (get: Getter) => QueryClient,
) {
  const queryAtom = atomWithQuery(getOptions, getQueryClient)

  return atom(
    (get) => {
      const result = get(queryAtom)

      if (result.data === undefined) {
        throw new Error(
          `Query must be prefetched before reading: ${JSON.stringify(getOptions(get).queryKey)}`,
        )
      }

      return result as PrefetchedQueryResult<typeof result>
    },
    (_get, set) => {
      set(queryAtom)
    },
  )
}

/**
 * Creates an atomWithSuspenseQuery-compatible atom for data that is already resolved.
 *
 * Use this when a suspense query atom is read from another atom after an outer
 * boundary or bootstrap step has already resolved it. The parameters match
 * atomWithSuspenseQuery, while the returned atom exposes only the resolved query
 * result instead of `QueryResult | Promise<QueryResult>`.
 *
 * This helper intentionally does not await the promise or create an async
 * derived atom. If the suspense query is still pending, reading the atom throws
 * to make the broken "already resolved" invariant explicit.
 */
export function atomWithResolvedSuspenseQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  getOptions: (
    get: Getter,
  ) => AtomWithSuspenseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  getQueryClient?: (get: Getter) => QueryClient,
): WritableAtom<ResolvedAtomWithSuspenseQueryResult<TData, TError>, [], void> {
  const queryAtom = atomWithSuspenseQuery(getOptions, getQueryClient)

  return atom(
    (get) => {
      const result = get(queryAtom)

      if (result instanceof Promise) {
        throw new TypeError(
          `Suspense query must be resolved before reading: ${JSON.stringify(getOptions(get).queryKey)}`,
        )
      }

      return result
    },
    (_get, set) => {
      set(queryAtom)
    },
  )
}
