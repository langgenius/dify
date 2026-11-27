'use client'

import type { PluginBanner } from '@dify/contracts/marketplace'
import type { MarketplaceViewProps } from './view'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '#i18n'
import { marketplaceQuery } from '@/service/marketplace'
import { useResetMarketplaceSearchModeOnMount } from './atoms'
import { normalizePluginBanners } from './home/banners'
import { MarketplaceView } from './view'

const BANNER_STALE_TIME = 1000 * 60 * 5

export type EmbeddedMarketplaceProps = Omit<MarketplaceViewProps, 'banners'> & {
  initialBanners?: PluginBanner[]
  /**
   * Locale used to fetch `initialBanners` during server rendering. `initialBanners`
   * is only applied while the client locale still matches it, so a client-side
   * language change refetches banners instead of seeding the new locale's cache
   * with banners from the previous language.
   */
  initialLocale?: string
}

export function EmbeddedMarketplace({
  initialBanners,
  initialLocale,
  variant = 'default',
  ...props
}: EmbeddedMarketplaceProps) {
  useResetMarketplaceSearchModeOnMount()
  const locale = useLocale()
  const { data: banners = [] } = useQuery(
    marketplaceQuery.banners.list.queryOptions({
      input: { query: { page: 'plugins', language: locale } },
      enabled: variant === 'home',
      // The cache holds the raw banners response. Server-rendered banners are already
      // normalized, and normalizing them again keeps them unchanged.
      initialData:
        locale === initialLocale && initialBanners
          ? { data: { banners: initialBanners } }
          : undefined,
      staleTime: BANNER_STALE_TIME,
      select: normalizePluginBanners,
    }),
  )

  return <MarketplaceView {...props} banners={banners} variant={variant} />
}
