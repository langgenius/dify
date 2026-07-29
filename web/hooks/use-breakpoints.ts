'use client'
import { useSyncExternalStore } from 'react'

export const MediaType = {
  mobile: 'mobile',
  tablet: 'tablet',
  pc: 'pc',
} as const

type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

const subscribeToViewport = (onStoreChange: () => void) => {
  window.addEventListener('resize', onStoreChange)
  return () => window.removeEventListener('resize', onStoreChange)
}

const getViewportWidth = () => globalThis.innerWidth
const getServerViewportWidth = () => 1024

const useBreakpoints = (): MediaTypeValue => {
  const width = useSyncExternalStore(
    subscribeToViewport,
    getViewportWidth,
    getServerViewportWidth,
  )

  if (width <= 640) return MediaType.mobile
  if (width <= 768) return MediaType.tablet
  return MediaType.pc
}

export default useBreakpoints
