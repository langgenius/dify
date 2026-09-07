'use client'

import type { PluginBanner } from '@dify/contracts/marketplace'
import type { MarketplaceViewProps } from './view'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useLocale } from '@/context/i18n'
import { useResetMarketplaceSearchModeOnMount } from './atoms'
import { fetchPluginBanners } from './home/banners'
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
    queryOptions({
      // fetchPluginBanners returns normalized PluginBanner[] rather than the
      // raw contract response, so it uses its own cache key instead of
      // impersonating the generated banners.list contract query.
      queryKey: ['marketplace-banners', locale],
      queryFn: () => fetchPluginBanners(locale),
      enabled: variant === 'home',
      initialData: locale === initialLocale ? initialBanners : undefined,
      staleTime: BANNER_STALE_TIME,
    }),
  )

  return <MarketplaceView {...props} banners={banners} variant={variant} />
}
