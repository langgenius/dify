import type { RefCallback } from 'react'
import { useCallback, useEffect, useRef } from 'react'

type FetchNextPageOptions = {
  cancelRefetch?: boolean
}

export type InfiniteScrollQuery = {
  error?: unknown
  fetchNextPage: (options?: FetchNextPageOptions) => Promise<unknown> | unknown
  hasNextPage?: boolean
  isFetching?: boolean
  isFetchingNextPage: boolean
  isLoading?: boolean
}

type UseInfiniteScrollResult<TRoot extends Element, TTarget extends Element> = {
  rootRef: RefCallback<TRoot>
  sentinelRef: RefCallback<TTarget>
}

type ObservedTarget<TRoot extends Element, TTarget extends Element> = {
  root: TRoot
  sentinel: TTarget
}

const ROOT_MARGIN = '0px 0px 300px 0px'

function canFetchNextPage(query: InfiniteScrollQuery) {
  return (
    Boolean(query.hasNextPage) &&
    !query.isLoading &&
    !query.isFetching &&
    !query.isFetchingNextPage &&
    !query.error
  )
}

export function useInfiniteScroll<
  TRoot extends Element = HTMLDivElement,
  TTarget extends Element = HTMLDivElement,
>(query: InfiniteScrollQuery): UseInfiniteScrollResult<TRoot, TTarget> {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const observedTargetRef = useRef<ObservedTarget<TRoot, TTarget> | null>(null)
  const rootRef = useRef<TRoot | null>(null)
  const sentinelRef = useRef<TTarget | null>(null)
  const loadingLockRef = useRef(false)
  const latestQueryRef = useRef(query)

  latestQueryRef.current = query

  const disconnectObserver = useCallback(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    observedTargetRef.current = null
  }, [])

  const connectObserver = useCallback(() => {
    const root = rootRef.current
    const sentinel = sentinelRef.current

    if (
      !canFetchNextPage(query) ||
      !root ||
      !sentinel ||
      typeof IntersectionObserver === 'undefined'
    ) {
      disconnectObserver()
      return
    }

    const observedTarget = observedTargetRef.current
    if (
      observerRef.current &&
      observedTarget?.root === root &&
      observedTarget.sentinel === sentinel
    ) {
      return
    }

    disconnectObserver()

    const observer = new IntersectionObserver(
      ([entry]) => {
        const latestQuery = latestQueryRef.current

        if (!entry?.isIntersecting || !canFetchNextPage(latestQuery) || loadingLockRef.current) {
          return
        }

        loadingLockRef.current = true

        const releaseLock = () => {
          loadingLockRef.current = false
        }

        try {
          const nextPage = latestQuery.fetchNextPage({ cancelRefetch: false })
          void Promise.resolve(nextPage).then(releaseLock, releaseLock)
        } catch {
          releaseLock()
        }
      },
      {
        root,
        rootMargin: ROOT_MARGIN,
        threshold: 0,
      },
    )

    observer.observe(sentinel)
    observerRef.current = observer
    observedTargetRef.current = { root, sentinel }
  }, [disconnectObserver, query])

  const setRootRef = useCallback(
    (node: TRoot | null) => {
      rootRef.current = node
      connectObserver()
    },
    [connectObserver],
  )

  const setSentinelRef = useCallback(
    (node: TTarget | null) => {
      sentinelRef.current = node
      connectObserver()
    },
    [connectObserver],
  )

  useEffect(() => {
    connectObserver()

    return disconnectObserver
  }, [connectObserver, disconnectObserver])

  return {
    rootRef: setRootRef,
    sentinelRef: setSentinelRef,
  }
}
