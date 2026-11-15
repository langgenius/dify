'use client'

import { useSyncExternalStore } from 'react'
import { CAROUSEL_BREAKPOINTS, CAROUSEL_PAGE_SIZE } from './collection-constants'

const subscribeToViewport = (onStoreChange: () => void) => {
  globalThis.window?.addEventListener('resize', onStoreChange)

  return () => globalThis.window?.removeEventListener('resize', onStoreChange)
}

const getViewportWidth = () => globalThis.window?.innerWidth ?? CAROUSEL_BREAKPOINTS.xl
const getServerViewportWidth = () => CAROUSEL_BREAKPOINTS.xl

function getCarouselItemsPerPage(viewportWidth: number) {
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.xl) return CAROUSEL_PAGE_SIZE.xl
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.lg) return CAROUSEL_PAGE_SIZE.lg
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.sm) return CAROUSEL_PAGE_SIZE.sm

  return CAROUSEL_PAGE_SIZE.base
}

/**
 * Viewport-derived carousel page size. useSyncExternalStore keeps the
 * hydration render on the server snapshot (xl) and applies the real viewport
 * in a follow-up render, so narrow viewports do not trigger a hydration
 * mismatch against the server-rendered markup.
 */
export function useCarouselItemsPerPage() {
  const viewportWidth = useSyncExternalStore(
    subscribeToViewport,
    getViewportWidth,
    getServerViewportWidth,
  )

  return getCarouselItemsPerPage(viewportWidth)
}
