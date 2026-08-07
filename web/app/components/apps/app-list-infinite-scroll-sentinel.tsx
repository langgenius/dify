'use client'

import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useRef } from 'react'

type AppListInfiniteScrollSentinelProps = {
  canLoadMore: boolean
  fetchNextPage: () => Promise<unknown>
  scrollViewportRef: RefObject<HTMLDivElement | null>
}

export function AppListInfiniteScrollSentinel({
  canLoadMore,
  fetchNextPage,
  scrollViewportRef,
}: AppListInfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const handleIntersection = useEffectEvent((entry: IntersectionObserverEntry) => {
    if (entry.isIntersecting && canLoadMore) void fetchNextPage()
  })

  useEffect(() => {
    const scrollRoot = scrollViewportRef.current
    const sentinel = sentinelRef.current
    if (!canLoadMore || !scrollRoot || !sentinel || typeof IntersectionObserver === 'undefined')
      return

    const preloadDistance = Math.max(160, Math.min(scrollRoot.clientHeight * 0.25, 320))
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) handleIntersection(entry)
      },
      {
        root: scrollRoot,
        rootMargin: `0px 0px ${preloadDistance}px 0px`,
        threshold: 0,
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [canLoadMore, scrollViewportRef])

  return <div ref={sentinelRef} aria-hidden className="h-px" />
}
