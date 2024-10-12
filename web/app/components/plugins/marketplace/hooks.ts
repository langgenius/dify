import { useEffect } from 'react'

export const useScrollIntersection = (
  rootRef: React.RefObject<HTMLDivElement>,
  anchorRef: React.RefObject<HTMLDivElement>,
  callback: (isIntersecting: boolean) => void,
) => {
  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (rootRef.current && anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        callback(entries[0].isIntersecting)
      }, {
        root: rootRef.current,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [rootRef, anchorRef, callback])
}
