'use client'

import type { MarketplaceViewProps } from './view'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useLocale } from '@/context/i18n'
import { marketplaceQuery } from '@/service/client'
import { fetchPluginBanners } from './home/banners'
import { MarketplaceView } from './view'

export type EmbeddedMarketplaceProps = Omit<MarketplaceViewProps, 'banners'>

export function EmbeddedMarketplace({ variant = 'default', ...props }: EmbeddedMarketplaceProps) {
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
    }),
  )

  return <MarketplaceView {...props} banners={banners} variant={variant} />
}
