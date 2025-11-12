'use client'
import React from 'react'

export const mediaTypeMap = {
  mobile: 'mobile',
  tablet: 'tablet',
  pc: 'pc',
}

export type MediaType = keyof typeof mediaTypeMap

const useBreakpoints = () => {
  const [width, setWidth] = React.useState(globalThis.innerWidth)
  const media = (() => {
    if (width <= 640)
      return mediaTypeMap.mobile
    if (width <= 768)
      return mediaTypeMap.tablet
    return mediaTypeMap.pc
  })()

  React.useEffect(() => {
    const handleWindowResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  return media
}

export default useBreakpoints
