'use client'

import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useRef } from 'react'

type InfiniteScrollSentinelProps = {
  canFetchNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  isFetchingNextPage: boolean
  scrollRootRef: RefObject<HTMLDivElement | null>
}

export const InfiniteScrollSentinel = ({
  canFetchNextPage,
  fetchNextPage,
  isFetchingNextPage,
  scrollRootRef,
}: InfiniteScrollSentinelProps) => {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const handleIntersection = useEffectEvent((entry: IntersectionObserverEntry) => {
    if (entry.isIntersecting && canFetchNextPage && !isFetchingNextPage) void fetchNextPage()
  })

  useEffect(() => {
    const scrollRoot = scrollRootRef.current
    const sentinel = sentinelRef.current
    if (
      !canFetchNextPage ||
      !scrollRoot ||
      !sentinel ||
      typeof IntersectionObserver === 'undefined'
    )
      return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) handleIntersection(entry)
      },
      {
        root: scrollRoot,
        rootMargin: '0px 0px 64px 0px',
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [canFetchNextPage, scrollRootRef])

  return <div ref={sentinelRef} aria-hidden className="h-px" />
}
