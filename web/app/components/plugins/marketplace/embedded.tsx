'use client'

import type { PluginBanner } from './home/banners'
import type { MarketplaceViewProps } from './view'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useLocale } from '@/context/i18n'
import { marketplaceQuery } from '@/service/client'
import { fetchPluginBanners } from './home/banners'
import { MarketplaceView } from './view'

const BANNER_STALE_TIME = 1000 * 60 * 5

export type EmbeddedMarketplaceProps = Omit<MarketplaceViewProps, 'banners'> & {
  initialBanners?: PluginBanner[]
}

export function EmbeddedMarketplace({
  initialBanners,
  variant = 'default',
  ...props
}: EmbeddedMarketplaceProps) {
  const locale = useLocale()
  const input = {
    query: {
      page: 'plugins' as const,
      language: locale,
    },
  }
  const { data: banners = [] } = useQuery(
    queryOptions({
      queryKey: [...marketplaceQuery.banners.list.queryKey({ input }), locale],
      queryFn: () => fetchPluginBanners(locale),
      enabled: variant === 'home',
      initialData: initialBanners,
      staleTime: BANNER_STALE_TIME,
    }),
  )

  return <MarketplaceView {...props} banners={banners} variant={variant} />
}
