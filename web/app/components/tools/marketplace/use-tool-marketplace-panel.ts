import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMarketplace } from './hooks'

type UseToolMarketplacePanelParams = {
  containerRef: RefObject<HTMLDivElement | null>
  keywords: string
  tagFilterValue: string[]
}

export function useToolMarketplacePanel({
  containerRef,
  keywords,
  tagFilterValue,
}: UseToolMarketplacePanelParams) {
  const toolListTailRef = useRef<HTMLDivElement>(null)
  const [marketplaceActivated, setMarketplaceActivated] = useState(
    () => !globalThis.IntersectionObserver,
  )
  const hasActiveSearchOrTagFilter = !!keywords || tagFilterValue.length > 0
  const shouldLoadMarketplace = marketplaceActivated || hasActiveSearchOrTagFilter
  const marketplaceContext = useMarketplace(keywords, tagFilterValue, shouldLoadMarketplace)
  const { handleScroll } = marketplaceContext
  const [isMarketplaceArrowVisible, setIsMarketplaceArrowVisible] = useState(true)

  const showMarketplacePanel = useCallback(() => {
    setMarketplaceActivated(true)
    containerRef.current?.scrollTo({
      top: toolListTailRef.current ? toolListTailRef.current.offsetTop - 80 : 0,
      behavior: 'smooth',
    })
  }, [containerRef])

  const onContainerScroll = useCallback(
    (e: Event) => {
      handleScroll(e)
      if (containerRef.current && toolListTailRef.current)
        setIsMarketplaceArrowVisible(
          containerRef.current.scrollTop < toolListTailRef.current.offsetTop - 80,
        )
    },
    [containerRef, handleScroll],
  )

  useEffect(() => {
    const container = containerRef.current
    if (container) container.addEventListener('scroll', onContainerScroll)

    return () => {
      if (container) container.removeEventListener('scroll', onContainerScroll)
    }
  }, [containerRef, onContainerScroll])

  useEffect(() => {
    const target = toolListTailRef.current
    if (!target || marketplaceActivated) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setMarketplaceActivated(true)
      observer.disconnect()
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [marketplaceActivated])

  return {
    isMarketplaceArrowVisible,
    marketplaceContext,
    showMarketplacePanel,
    toolListTailRef,
  }
}
