import type { UseQueryResult } from '@tanstack/react-query'
import { useDebugValue } from 'react'
import { markErrorHandled } from './handled-error'

type OwnableQuery = Pick<UseQueryResult<unknown>, 'data' | 'error' | 'isError' | 'isFetching'> & {
  refetch: () => unknown
}

/** A failed first load an owner renders in place of its data, with a retry. */
export type OwnedQueryError = {
  error: unknown
  retry: () => void
  retrying: boolean
}

const failedFirstLoad = (query: OwnableQuery) =>
  query.isError && query.data === undefined && query.error != null

/**
 * The failed first load of `query`, for its owner to render in place of the data, and
 * `undefined` otherwise. Rendering it claims the error, so the query cache does not also toast it;
 * a failed refetch keeps the cached data and still toasts. Call it only where the result is
 * rendered: a claimed error is shown nowhere else.
 */
export function useOwnedQueryError(
  query: OwnableQuery,
  /** `false` while the owner does not render the failure, such as a closed popup or a redirect. */
  shown = true,
): OwnedQueryError | undefined {
  return useOwnedQueryErrors(shown ? [query] : [])
}

/**
 * The first failed first load among `queries`, for an owner that renders one error state for
 * several reads. It claims every failed one, and its retry refetches each of them.
 */
export function useOwnedQueryErrors(queries: readonly OwnableQuery[]): OwnedQueryError | undefined {
  const failed = queries.filter(failedFirstLoad)
  const first = failed[0]
  useDebugValue(failed.length ? `${failed.length} failed first load(s) claimed` : 'none')
  if (!first) return undefined
  // Claimed during render, before the cache reports the failure after this render commits.
  for (const query of failed) markErrorHandled(query.error)
  return {
    error: first.error,
    retry: () => {
      for (const query of failed) void query.refetch()
    },
    retrying: failed.some((query) => query.isFetching),
  }
}

type OwnableInfiniteQuery = OwnableQuery & {
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
}

/**
 * The failed next page of `query`, for a list that renders it below the loaded pages with a retry,
 * and `undefined` otherwise. Rendering it claims the error, so the query cache does not also toast
 * it. Call it only where the result is rendered.
 */
export function useOwnedNextPageError(
  query: OwnableInfiniteQuery,
  /** `false` while the list does not render the failure, such as a closed popup. */
  shown = true,
): OwnedQueryError | undefined {
  const failed = shown && query.isFetchNextPageError && query.error != null
  useDebugValue(failed ? 'failed next page claimed' : 'none')
  if (!failed) return undefined
  markErrorHandled(query.error)
  return {
    error: query.error,
    retry: () => void query.fetchNextPage(),
    retrying: query.isFetchingNextPage,
  }
}
