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
