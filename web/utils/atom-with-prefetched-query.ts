import type { DefaultError, QueryClient, QueryKey } from '@tanstack/react-query'
import type { Getter, WritableAtom } from 'jotai'
import type {
  AtomWithQueryOptions,
  AtomWithQueryResult,
  DefinedInitialDataOptions,
  UndefinedInitialDataOptions,
} from 'jotai-tanstack-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'

type PrefetchedQueryResult<TResult extends { data: unknown }> = TResult extends unknown
  ? Omit<TResult, 'data'> & {
    data: Exclude<TResult['data'], undefined>
  }
  : never

type PrefetchedAtomWithQueryResult<TData, TError = DefaultError> = PrefetchedQueryResult<
  AtomWithQueryResult<TData, TError>
>

/**
 * Mirrors atomWithQuery for query data that must already be prefetched/hydrated.
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
