import { useEffect } from 'react'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import { useMarketplaceContext } from '@/app/components/plugins/marketplace/context'

export const useScrollIntersection = (
  anchorRef: React.RefObject<HTMLDivElement>,
) => {
  const containerRef = usePluginPageContext(v => v.containerRef)
  const intersected = useMarketplaceContext(v => v.intersected)
  const setIntersected = useMarketplaceContext(v => v.setIntersected)

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (containerRef?.current && anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        const isIntersecting = entries[0].isIntersecting

        if (isIntersecting && !intersected)
          setIntersected(true)

        if (!isIntersecting && intersected)
          setIntersected(false)
      }, {
        root: containerRef.current,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [containerRef, anchorRef, intersected, setIntersected])
}
