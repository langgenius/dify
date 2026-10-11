'use client'

import type { RefObject } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useEffectEvent, useRef } from 'react'

type PreloadDistance = number | ((scrollContainer: Element) => number)

type InfiniteScrollSentinelProps = Readonly<{
  canLoadMore: boolean
  className?: string
  onLoadMore: () => void
  preloadDistance: PreloadDistance
  scrollContainerRef: RefObject<Element | null>
}>

export function InfiniteScrollSentinel({
  canLoadMore,
  className,
  onLoadMore,
  preloadDistance,
  scrollContainerRef,
}: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const handleIntersection = useEffectEvent((entry: IntersectionObserverEntry) => {
    if (entry.isIntersecting && canLoadMore) onLoadMore()
  })

  useEffect(() => {
    if (!canLoadMore) return

    const scrollContainer = scrollContainerRef.current
    const sentinel = sentinelRef.current

    if (!scrollContainer || !sentinel || typeof IntersectionObserver === 'undefined') return

    const resolvedPreloadDistance =
      typeof preloadDistance === 'function' ? preloadDistance(scrollContainer) : preloadDistance
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) handleIntersection(entry)
      },
      {
        root: scrollContainer,
        rootMargin: `0px 0px ${resolvedPreloadDistance}px 0px`,
        threshold: 0,
      },
    )

    observer.observe(sentinel)

    return () => observer.disconnect()
  }, [canLoadMore, preloadDistance, scrollContainerRef])

  return <div ref={sentinelRef} aria-hidden className={cn('h-px', className)} />
}
