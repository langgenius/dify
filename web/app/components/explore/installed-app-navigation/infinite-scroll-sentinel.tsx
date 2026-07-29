'use client'

import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useRef } from 'react'
import Loading from '@/app/components/base/loading'

type InfiniteScrollSentinelProps = {
  fetchNextPage: () => Promise<unknown>
  isEnabled: boolean
  isFetchingNextPage: boolean
  scrollRootRef: RefObject<HTMLDivElement | null>
}

export const InfiniteScrollSentinel = ({
  fetchNextPage,
  isEnabled,
  isFetchingNextPage,
  scrollRootRef,
}: InfiniteScrollSentinelProps) => {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const handleIntersection = useEffectEvent((entry: IntersectionObserverEntry) => {
    if (entry.isIntersecting && isEnabled) void fetchNextPage()
  })

  useEffect(() => {
    const scrollRoot = scrollRootRef.current
    const sentinel = sentinelRef.current
    if (!isEnabled || !scrollRoot || !sentinel || typeof IntersectionObserver === 'undefined')
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
  }, [isEnabled, scrollRootRef])

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {isFetchingNextPage && <Loading className="h-8" />}
    </>
  )
}
