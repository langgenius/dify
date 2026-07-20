import type { RefCallback } from 'react'
import { useCallback, useEffect, useRef } from 'react'

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
  rootRef: RefCallback<TRoot>
  sentinelRef: RefCallback<TTarget>
}

type ObservedTarget<TRoot extends Element, TTarget extends Element> = {
  rootEl: TRoot | null
  rootMargin: string
  sentinelEl: TTarget
  threshold: number | number[]
  useWindow: boolean
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

  const observerRef = useRef<IntersectionObserver | null>(null)
  const observedTargetRef = useRef<ObservedTarget<TRoot, TTarget> | null>(null)
  const rootElRef = useRef<TRoot | null>(null)
  const sentinelElRef = useRef<TTarget | null>(null)
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

  const canLoad =
    enabled &&
    Boolean(query.hasNextPage) &&
    !query.isFetchingNextPage &&
    !(query.isLoading ?? false) &&
    !query.error &&
    !(guardOnFetching && (query.isFetching ?? false))

  const disconnectObserver = useCallback(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    observedTargetRef.current = null
  }, [])

  const connectObserver = useCallback(() => {
    if (!canLoad) {
      disconnectObserver()
      return
    }

    const rootEl = rootElRef.current
    const sentinelEl = sentinelElRef.current

    if (!sentinelEl) {
      disconnectObserver()
      return
    }

    if (!useWindow && !rootEl) {
      disconnectObserver()
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      disconnectObserver()
      return
    }

    const observedTarget = observedTargetRef.current
    if (
      observerRef.current &&
      observedTarget?.rootEl === rootEl &&
      observedTarget.sentinelEl === sentinelEl &&
      observedTarget.rootMargin === rootMargin &&
      observedTarget.threshold === threshold &&
      observedTarget.useWindow === useWindow
    ) {
      return
    }

    disconnectObserver()

    const observer = new IntersectionObserver(
      ([entry]) => {
        const latest = latestRef.current

        if (!entry?.isIntersecting) return

        if (
          !latest.enabled ||
          !latest.hasNextPage ||
          latest.isLoading ||
          latest.isFetchingNextPage ||
          latest.error ||
          (latest.guardOnFetching && latest.isFetching) ||
          loadingLockRef.current
        ) {
          return
        }

        loadingLockRef.current = true

        const nextPage = latest.fetchNextPage({
          cancelRefetch: latest.cancelRefetch,
        })

        void Promise.resolve(nextPage).finally(() => {
          loadingLockRef.current = false
        })
      },
      {
        root: useWindow ? null : rootEl,
        rootMargin,
        threshold,
      },
    )

    observer.observe(sentinelEl)
    observerRef.current = observer
    observedTargetRef.current = {
      rootEl,
      rootMargin,
      sentinelEl,
      threshold,
      useWindow,
    }
  }, [canLoad, disconnectObserver, rootMargin, threshold, useWindow])

  const rootRef = useCallback(
    (node: TRoot | null) => {
      rootElRef.current = node
      connectObserver()
    },
    [connectObserver],
  )

  const sentinelRef = useCallback(
    (node: TTarget | null) => {
      sentinelElRef.current = node
      connectObserver()
    },
    [connectObserver],
  )

  useEffect(() => {
    connectObserver()
  }, [connectObserver])

  return {
    rootRef,
    sentinelRef,
  }
}
