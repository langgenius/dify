'use client'

import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import { keepPreviousData, skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { marketplaceQuery } from '@/service/marketplace'
import { marketplaceLinks } from './links'

export const useMarketplace = () => {
  const { data: enabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.enable_marketplace,
  })

  return enabled ? marketplaceLinks : null
}

export const useMarketplacePluginVersions = (pluginId: string | undefined, enabled: boolean) => {
  const marketplace = useMarketplace()
  const [organization, pluginName] = pluginId?.split('/') ?? []

  return useQuery(
    marketplaceQuery.pluginVersions.queryOptions({
      input:
        marketplace && organization && pluginName
          ? { params: { organization, pluginName }, query: { page: 1, page_size: 100 } }
          : skipToken,
      enabled,
      retry: false,
    }),
  )
}

export const useMarketplacePluginSearch = <TData>(
  query: string,
  { enabled, select }: { enabled: boolean; select: (plugins: MarketplacePlugin[]) => TData },
) => {
  const marketplace = useMarketplace()

  return useQuery(
    marketplaceQuery.searchAdvanced.queryOptions({
      input: marketplace
        ? { params: { kind: 'plugins' }, body: { page: 1, page_size: 10, query } }
        : skipToken,
      enabled,
      retry: false,
      placeholderData: keepPreviousData,
      select: (response) => select(response.data?.plugins ?? []),
    }),
  )
}
