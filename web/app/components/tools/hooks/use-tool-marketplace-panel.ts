import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMarketplace } from '@/app/components/tools/marketplace/hooks'

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
  const marketplaceContext = useMarketplace(keywords, tagFilterValue)
  const { handleScroll } = marketplaceContext
  const [isMarketplaceArrowVisible, setIsMarketplaceArrowVisible] = useState(true)

  const showMarketplacePanel = useCallback(() => {
    containerRef.current?.scrollTo({
      top: toolListTailRef.current
        ? toolListTailRef.current.offsetTop - 80
        : 0,
      behavior: 'smooth',
    })
  }, [containerRef])

  const onContainerScroll = useCallback((e: Event) => {
    handleScroll(e)
    if (containerRef.current && toolListTailRef.current)
      setIsMarketplaceArrowVisible(containerRef.current.scrollTop < (toolListTailRef.current.offsetTop - 80))
  }, [containerRef, handleScroll])

  useEffect(() => {
    const container = containerRef.current
    if (container)
      container.addEventListener('scroll', onContainerScroll)

    return () => {
      if (container)
        container.removeEventListener('scroll', onContainerScroll)
    }
  }, [onContainerScroll])

  return {
    containerRef,
    isMarketplaceArrowVisible,
    marketplaceContext,
    showMarketplacePanel,
    toolListTailRef,
  }
}
