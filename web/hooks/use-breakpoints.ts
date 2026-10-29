'use client'
import * as React from 'react'

export const MediaType = {
  mobile: 'mobile',
  tablet: 'tablet',
  pc: 'pc',
} as const

type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener('resize', onStoreChange)
  return () => window.removeEventListener('resize', onStoreChange)
}

const getSnapshot = (): MediaTypeValue => {
  if (window.innerWidth <= 640) return MediaType.mobile
  if (window.innerWidth <= 768) return MediaType.tablet
  return MediaType.pc
}

// Match the server's desktop fallback during hydration before reading the viewport.
const getServerSnapshot = (): MediaTypeValue => MediaType.pc

const useBreakpoints = (): MediaTypeValue =>
  React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

export default useBreakpoints
