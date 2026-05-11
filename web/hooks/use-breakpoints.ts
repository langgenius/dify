'use client'
import * as React from 'react'

export const MediaType = {
  mobile: 'mobile',
  tablet: 'tablet',
  pc: 'pc',
} as const

type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

const useBreakpoints = (): MediaTypeValue => {
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
