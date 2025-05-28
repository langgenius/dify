import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginType } from '@/app/components/plugins/types'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { useAllToolProviders } from '@/service/use-tools'

export const useMarketplace = (searchPluginText: string, filterPluginTags: string[]) => {
  const { data: toolProvidersData, isSuccess } = useAllToolProviders()
  const exclude = useMemo(() => {
    if (isSuccess)
      return toolProvidersData?.filter(toolProvider => !!toolProvider.plugin_id).map(toolProvider => toolProvider.plugin_id!)
  }, [isSuccess, toolProvidersData])
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
    queryPluginsWithDebounced,
    isLoading: isPluginsLoading,
    total: pluginsTotal,
  } = useMarketplacePlugins()
  const [page, setPage] = useState(1)
  const pageRef = useRef(page)
  const searchPluginTextRef = useRef(searchPluginText)
  const filterPluginTagsRef = useRef(filterPluginTags)

  useEffect(() => {
    searchPluginTextRef.current = searchPluginText
    filterPluginTagsRef.current = filterPluginTags
  }, [searchPluginText, filterPluginTags])
  useEffect(() => {
    if ((searchPluginText || filterPluginTags.length) && isSuccess) {
      setPage(1)
      pageRef.current = 1

      if (searchPluginText) {
        queryPluginsWithDebounced({
          category: PluginType.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
          page: pageRef.current,
        })
        return
      }
      queryPlugins({
        category: PluginType.tool,
        query: searchPluginText,
        tags: filterPluginTags,
        exclude,
        type: 'plugin',
        page: pageRef.current,
      })
    }
    else {
      if (isSuccess) {
        queryMarketplaceCollectionsAndPlugins({
          category: PluginType.tool,
          condition: getMarketplaceListCondition(PluginType.tool),
          exclude,
          type: 'plugin',
        })
        resetPlugins()
      }
    }
  }, [searchPluginText, filterPluginTags, queryPlugins, queryMarketplaceCollectionsAndPlugins, queryPluginsWithDebounced, resetPlugins, exclude, isSuccess])

  const handleScroll = useCallback((e: Event) => {
    const target = e.target as HTMLDivElement
    const {
      scrollTop,
      scrollHeight,
      clientHeight,
    } = target
    if (scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0) {
      const searchPluginText = searchPluginTextRef.current
      const filterPluginTags = filterPluginTagsRef.current
      if (pluginsTotal && plugins && pluginsTotal > plugins.length && (!!searchPluginText || !!filterPluginTags.length)) {
        setPage(pageRef.current + 1)
        pageRef.current++

        queryPlugins({
          category: PluginType.tool,
          query: searchPluginText,
          tags: filterPluginTags,
          exclude,
          type: 'plugin',
          page: pageRef.current,
        })
      }
    }
  }, [exclude, plugins, pluginsTotal, queryPlugins])

  return {
    isLoading: isLoading || isPluginsLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
    handleScroll,
    page,
  }
}
