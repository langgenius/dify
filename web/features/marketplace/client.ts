'use client'

import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import type { QueryClient } from '@tanstack/react-query'
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
      // Its only caller, the search session, shows a failed search over the previous results.
      meta: { errorToast: false },
    }),
  )
}

// The legacy plugin search and collection hooks exclude installed plugins, so refetch them after
// the workspace installs, updates or removes one.
export const invalidateMarketplacePluginLists = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({
      queryKey: marketplaceQuery.searchAdvanced.key({ type: 'infinite' }),
    }),
    queryClient.invalidateQueries({ queryKey: marketplaceQuery.collectionPlugins.key() }),
  ])
