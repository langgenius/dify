import { useEffect } from 'react'

export const useScrollIntersection = (
  containerRef: React.RefObject<HTMLDivElement>,
  anchorRef: React.RefObject<HTMLDivElement>,
  callback: (isIntersecting: boolean) => void,
) => {
  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (containerRef?.current && anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        const isIntersecting = entries[0].isIntersecting
        callback(isIntersecting)
      }, {
        root: containerRef.current,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [containerRef, anchorRef, callback])
}
