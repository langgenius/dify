'use client'
import * as React from 'react'

/**
 * MediaType is defined as a const object to avoid non-erasable enum emit.
 * This approach aligns with the erasable-syntax-only setup.
 */
export const MediaType = {
  mobile: 'mobile',
  tablet: 'tablet',
  pc: 'pc',
} as const

export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

const useBreakpoints = () => {
  const [width, setWidth] = React.useState(globalThis.innerWidth)
  const media = (() => {
    if (width <= 640)
      return MediaType.mobile
    if (width <= 768)
      return MediaType.tablet
    return MediaType.pc
  })()

  React.useEffect(() => {
    const handleWindowResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  return media
}

export default useBreakpoints
