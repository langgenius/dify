import { useSyncExternalStore } from 'react'
import { getCreatorCenterUrl } from '@/features/marketplace/links'

const subscribe = () => () => {}

/**
 * Prefer the current page origin when this is the standalone Marketplace, so a
 * .dev deployment cannot inherit a baked-in .ai Creator Center URL.
 */
export const useCreatorCenterUrl = () => {
  return useSyncExternalStore(
    subscribe,
    () => getCreatorCenterUrl(window.location.origin),
    () => getCreatorCenterUrl(),
  )
}
