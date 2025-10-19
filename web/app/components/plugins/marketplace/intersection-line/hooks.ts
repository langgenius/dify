import { useEffect } from 'react'
import { useMarketplaceContext } from '@/app/components/plugins/marketplace/context'

export const useScrollIntersection = (
  anchorRef: React.RefObject<HTMLDivElement | null>,
  intersectionContainerId = 'marketplace-container',
) => {
  const intersected = useMarketplaceContext(v => v.intersected)
  const setIntersected = useMarketplaceContext(v => v.setIntersected)

  useEffect(() => {
    const container = document.getElementById(intersectionContainerId)
    let observer: IntersectionObserver | undefined
    if (container && anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        const isIntersecting = entries[0].isIntersecting

        if (isIntersecting && !intersected)
          setIntersected(true)

        if (!isIntersecting && intersected)
          setIntersected(false)
      }, {
        root: container,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [anchorRef, intersected, setIntersected, intersectionContainerId])
}
