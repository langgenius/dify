import type { RefCallback } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

type FetchNextPageOptions = {
  cancelRefetch?: boolean
}

export type InfiniteScrollQueryResult = {
  error?: unknown
  fetchNextPage: (options?: FetchNextPageOptions) => Promise<unknown> | unknown
  hasNextPage?: boolean
  isFetching?: boolean
  isFetchingNextPage: boolean
  isLoading?: boolean
}

export type UseInfiniteScrollOptions = {
  cancelRefetch?: boolean
  enabled?: boolean
  guardOnFetching?: boolean
  rootMargin?: string
  threshold?: number | number[]
  useWindow?: boolean
}

type UseInfiniteScrollResult<TRoot extends Element, TTarget extends Element> = {
  rootEl: TRoot | null
  rootRef: RefCallback<TRoot>
  sentinelEl: TTarget | null
  sentinelRef: RefCallback<TTarget>
}

export function useInfiniteScroll<
  TRoot extends Element = HTMLDivElement,
  TTarget extends Element = HTMLDivElement,
>(
  query: InfiniteScrollQueryResult,
  options: UseInfiniteScrollOptions = {},
): UseInfiniteScrollResult<TRoot, TTarget> {
  const {
    cancelRefetch = false,
    enabled = true,
    guardOnFetching = true,
    rootMargin = '0px 0px 300px 0px',
    threshold = 0,
    useWindow = false,
  } = options

  const [rootEl, setRootEl] = useState<TRoot | null>(null)
  const [sentinelEl, setSentinelEl] = useState<TTarget | null>(null)
  const loadingLockRef = useRef(false)

  const latestRef = useRef({
    cancelRefetch,
    enabled,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    guardOnFetching,
    hasNextPage: Boolean(query.hasNextPage),
    isFetching: query.isFetching ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading ?? false,
  })

  latestRef.current = {
    cancelRefetch,
    enabled,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    guardOnFetching,
    hasNextPage: Boolean(query.hasNextPage),
    isFetching: query.isFetching ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading ?? false,
  }

  const rootRef = useCallback((node: TRoot | null) => {
    setRootEl(node)
  }, [])

  const sentinelRef = useCallback((node: TTarget | null) => {
    setSentinelEl(node)
  }, [])

  const canLoad = enabled
    && Boolean(query.hasNextPage)
    && !query.isFetchingNextPage
    && !(query.isLoading ?? false)
    && !query.error
    && !(guardOnFetching && (query.isFetching ?? false))

  useEffect(() => {
    if (!canLoad)
      return

    if (!sentinelEl)
      return

    if (!useWindow && !rootEl)
      return

    if (typeof IntersectionObserver === 'undefined')
      return

    const observer = new IntersectionObserver(([entry]) => {
      const latest = latestRef.current

      if (!entry?.isIntersecting)
        return

      if (!latest.enabled
        || !latest.hasNextPage
        || latest.isLoading
        || latest.isFetchingNextPage
        || latest.error
        || (latest.guardOnFetching && latest.isFetching)
        || loadingLockRef.current) {
        return
      }

      loadingLockRef.current = true

      const nextPage = latest.fetchNextPage({
        cancelRefetch: latest.cancelRefetch,
      })

      void Promise.resolve(nextPage).finally(() => {
        loadingLockRef.current = false
      })
    }, {
      root: useWindow ? null : rootEl,
      rootMargin,
      threshold,
    })

    observer.observe(sentinelEl)

    return () => observer.disconnect()
  }, [canLoad, rootEl, rootMargin, sentinelEl, threshold, useWindow])

  return {
    rootEl,
    rootRef,
    sentinelEl,
    sentinelRef,
  }
}
