import { useCallback, useEffect, useRef, useState } from 'react'
import { useMarketplace } from '@/app/components/tools/marketplace/hooks'

type UseToolMarketplacePanelParams = {
  keywords: string
  tagFilterValue: string[]
}

export function useToolMarketplacePanel({
  keywords,
  tagFilterValue,
}: UseToolMarketplacePanelParams) {
  const containerRef = useRef<HTMLDivElement>(null)
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
  }, [])

  const onContainerScroll = useCallback((e: Event) => {
    handleScroll(e)
    if (containerRef.current && toolListTailRef.current)
      setIsMarketplaceArrowVisible(containerRef.current.scrollTop < (toolListTailRef.current.offsetTop - 80))
  }, [handleScroll])

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
