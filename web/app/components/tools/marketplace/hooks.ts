import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { SCROLL_BOTTOM_THRESHOLD } from '@/app/components/plugins/marketplace/constants'
import {
  MARKETPLACE_PANEL_CACHE_OPTIONS,
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/query'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'

export const useToolMarketplace = (
  searchPluginText: string,
  filterPluginTags: string[],
  enabled = true,
) => {
  const { data: installedPluginIds, isSuccess } = useQuery(
    consoleQuery.workspaces.current.plugin.installedIds.get.queryOptions({
      input: { query: { category: 'tool' } },
      enabled,
    }),
  )
  const exclude = installedPluginIds?.plugin_ids
  const isSearching = !!searchPluginText || filterPluginTags.length > 0
  // Collections are the default view; a search or tag filter switches to the paged plugin search.
  const collectionsQuery = useMarketplaceCollectionsAndPlugins(
    {
      category: PluginCategoryEnum.tool,
      condition: getMarketplaceListCondition(PluginCategoryEnum.tool),
      exclude,
      type: 'plugin',
    },
    enabled && isSuccess && !isSearching,
    MARKETPLACE_PANEL_CACHE_OPTIONS,
  )
  const pluginsSearchParams: PluginsSearchParams | undefined =
    isSearching && isSuccess
      ? {
          category: PluginCategoryEnum.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
        }
      : undefined
  const pluginsQuery = useMarketplacePlugins(pluginsSearchParams, {
    enabled,
    keepPreviousResults: false,
    ...MARKETPLACE_PANEL_CACHE_OPTIONS,
  })
  const { fetchNextPage, hasNextPage } = pluginsQuery
  // A failed search shows no results rather than the collections.
  const plugins = pluginsSearchParams
    ? (pluginsQuery.data?.pages.flatMap((page) => page.plugins) ??
      (pluginsQuery.isError ? [] : undefined))
    : undefined
  const searchPluginTextRef = useRef(searchPluginText)
  const filterPluginTagsRef = useRef(filterPluginTags)

  useEffect(() => {
    searchPluginTextRef.current = searchPluginText
    filterPluginTagsRef.current = filterPluginTags
  }, [searchPluginText, filterPluginTags])

  const handleScroll = useCallback(
    (e: Event) => {
      const target = e.target as HTMLDivElement
      const { scrollTop, scrollHeight, clientHeight } = target
      if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD && scrollTop > 0) {
        const searchPluginText = searchPluginTextRef.current
        const filterPluginTags = filterPluginTagsRef.current
        if (enabled && hasNextPage && (!!searchPluginText || !!filterPluginTags.length))
          void fetchNextPage()
      }
    },
    [enabled, fetchNextPage, hasNextPage],
  )

  return {
    isLoading: enabled && (collectionsQuery.isLoading || pluginsQuery.isLoading),
    marketplaceCollections: collectionsQuery.data?.marketplaceCollections,
    marketplaceCollectionPluginsMap: collectionsQuery.data?.marketplaceCollectionPluginsMap,
    plugins,
    handleScroll,
    page: Math.max(pluginsQuery.data?.pages.length ?? 0, 1),
  }
}
