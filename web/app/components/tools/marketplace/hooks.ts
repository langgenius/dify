import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { SCROLL_BOTTOM_THRESHOLD } from '@/app/components/plugins/marketplace/constants'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/client'

export const useMarketplace = (searchPluginText: string, filterPluginTags: string[]) => {
  const { data: installedPluginIds, isSuccess } = useQuery(
    consoleQuery.workspaces.current.plugin.installedIds.get.queryOptions({
      input: { query: { category: 'tool' } },
    }),
  )
  const exclude = installedPluginIds?.plugin_ids
  const {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    queryMarketplaceCollectionsAndPlugins,
  } = useMarketplaceCollectionsAndPlugins()
  const {
    plugins,
    resetPlugins,
    queryPlugins,
    isLoading: isPluginsLoading,
    fetchNextPage,
    hasNextPage,
    page: pluginsPage,
  } = useMarketplacePlugins()
  const searchPluginTextRef = useRef(searchPluginText)
  const filterPluginTagsRef = useRef(filterPluginTags)

  useEffect(() => {
    searchPluginTextRef.current = searchPluginText
    filterPluginTagsRef.current = filterPluginTags
  }, [searchPluginText, filterPluginTags])
  useEffect(() => {
    if ((searchPluginText || filterPluginTags.length) && isSuccess) {
      if (searchPluginText) {
        queryPlugins({
          category: PluginCategoryEnum.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
        })
        return
      }
      queryPlugins({
        category: PluginCategoryEnum.tool,
        query: searchPluginText,
        tags: filterPluginTags,
        exclude,
        type: 'plugin',
      })
    } else {
      if (isSuccess) {
        queryMarketplaceCollectionsAndPlugins({
          category: PluginCategoryEnum.tool,
          condition: getMarketplaceListCondition(PluginCategoryEnum.tool),
          exclude,
          type: 'plugin',
        })
        resetPlugins()
      }
    }
  }, [
    searchPluginText,
    filterPluginTags,
    queryPlugins,
    queryMarketplaceCollectionsAndPlugins,
    resetPlugins,
    exclude,
    isSuccess,
  ])

  const handleScroll = useCallback(
    (e: Event) => {
      const target = e.target as HTMLDivElement
      const { scrollTop, scrollHeight, clientHeight } = target
      if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD && scrollTop > 0) {
        const searchPluginText = searchPluginTextRef.current
        const filterPluginTags = filterPluginTagsRef.current
        if (hasNextPage && (!!searchPluginText || !!filterPluginTags.length)) fetchNextPage()
      }
    },
    [exclude, fetchNextPage, hasNextPage, plugins, queryPlugins],
  )

  return {
    isLoading: isLoading || isPluginsLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
    handleScroll,
    page: Math.max(pluginsPage || 0, 1),
  }
}
