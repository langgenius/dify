import { useEffect } from 'react'
import { useContextSelector } from 'use-context-selector'
import { PluginPageContext } from '../../plugin-page/context'
import { MarketplaceContext } from '../context'

export const useScrollIntersection = (
  anchorRef: React.RefObject<HTMLDivElement>,
) => {
  const containerRef = useContextSelector(PluginPageContext, v => v.containerRef)
  const scrollIntersected = useContextSelector(MarketplaceContext, v => v.scrollIntersected)
  const setScrollIntersected = useContextSelector(MarketplaceContext, v => v.setScrollIntersected)

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (containerRef.current && anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        console.log(entries, 'entries')
        if (entries[0].isIntersecting && !scrollIntersected)
          setScrollIntersected(true)

        if (!entries[0].isIntersecting && scrollIntersected)
          setScrollIntersected(false)
      }, {
        root: containerRef.current,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [containerRef, anchorRef, scrollIntersected, setScrollIntersected])
}
