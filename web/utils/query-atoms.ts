import type { DefaultError, QueryClient, QueryKey } from '@tanstack/react-query'
import type { Getter, WritableAtom } from 'jotai'
import type {
  AtomWithSuspenseQueryOptions,
  AtomWithSuspenseQueryResult,
} from 'jotai-tanstack-query'
import { atom } from 'jotai'
import { atomWithSuspenseQuery } from 'jotai-tanstack-query'

type ResolvedAtomWithSuspenseQueryResult<TData, TError = DefaultError> = Awaited<
  AtomWithSuspenseQueryResult<TData, TError>
>

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
  getOptions: (get: Getter) => AtomWithSuspenseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
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
