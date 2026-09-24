import { useSyncExternalStore } from 'react'

export const PUBLIC_CREATOR_CENTER_URL = 'https://creators.dify.ai/'

const subscribe = () => () => {}

/**
 * marketplace.dify.ai → creators.dify.ai
 * marketplace.dify.dev → creators.dify.dev
 * marketplace-staging.dify.dev → creators-staging.dify.dev
 */
export const rewriteMarketplaceOriginToCreators = (origin: string): string | null => {
  if (!origin) return null

  try {
    const marketplaceUrl = new URL(origin)
    const [service, ...domain] = marketplaceUrl.hostname.split('.')
    if (!service?.startsWith('marketplace') || domain.length === 0) return null

    marketplaceUrl.hostname = [service.replace(/^marketplace/, 'creators'), ...domain].join('.')
    marketplaceUrl.pathname = '/'
    marketplaceUrl.search = ''
    marketplaceUrl.hash = ''
    return marketplaceUrl.toString()
  } catch {
    return null
  }
}

export const getCreatorCenterUrl = (marketplaceUrlPrefix: string, pageOrigin?: string): string => {
  return (
    rewriteMarketplaceOriginToCreators(pageOrigin ?? '') ||
    rewriteMarketplaceOriginToCreators(marketplaceUrlPrefix) ||
    PUBLIC_CREATOR_CENTER_URL
  )
}

/**
 * Prefer the current page origin when this is the standalone Marketplace, so a
 * .dev deployment cannot inherit a baked-in .ai Creator Center URL.
 */
export const useCreatorCenterUrl = (marketplaceUrlPrefix: string) => {
  return useSyncExternalStore(
    subscribe,
    () => getCreatorCenterUrl(marketplaceUrlPrefix, window.location.origin),
    () => getCreatorCenterUrl(marketplaceUrlPrefix),
  )
}
