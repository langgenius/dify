'use client'

import type { ReactNode } from 'react'
import {
  useCallback,
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'
import { useDebounceFn } from 'ahooks'
import { PLUGIN_TYPE_SEARCH_MAP } from './plugin-type-switch'
import type { Plugin } from '../types'
import type {
  CollectionsAndPluginsSearchParams,
  MarketplaceCollection,
  PluginsSearchParams,
  PluginsSort,
} from './types'
import {
  getMarketplaceCollectionsAndPlugins,
  getMarketplacePlugins,
} from './utils'
import { DEFAULT_SORT } from './constants'

export type MarketplaceContextValue = {
  intersected: boolean
  setIntersected: (intersected: boolean) => void
  searchPluginText: string
  handleSearchPluginTextChange: (text: string) => void
  filterPluginTags: string[]
  handleFilterPluginTagsChange: (tags: string[]) => void
  activePluginType: string
  handleActivePluginTypeChange: (type: string) => void
  plugins?: Plugin[]
  setPlugins: (plugins: Plugin[]) => void
  sort: PluginsSort
  handleSortChange: (sort: PluginsSort) => void
  marketplaceCollectionsFromClient?: MarketplaceCollection[]
  setMarketplaceCollectionsFromClient: (collections: MarketplaceCollection[]) => void
  marketplaceCollectionPluginsMapFromClient?: Record<string, Plugin[]>
  setMarketplaceCollectionPluginsMapFromClient: (map: Record<string, Plugin[]>) => void
}

export const MarketplaceContext = createContext<MarketplaceContextValue>({
  intersected: true,
  setIntersected: () => {},
  searchPluginText: '',
  handleSearchPluginTextChange: () => {},
  filterPluginTags: [],
  handleFilterPluginTagsChange: () => {},
  activePluginType: PLUGIN_TYPE_SEARCH_MAP.all,
  handleActivePluginTypeChange: () => {},
  plugins: undefined,
  setPlugins: () => {},
  sort: DEFAULT_SORT,
  handleSortChange: () => {},
  marketplaceCollectionsFromClient: [],
  setMarketplaceCollectionsFromClient: () => {},
  marketplaceCollectionPluginsMapFromClient: {},
  setMarketplaceCollectionPluginsMapFromClient: () => {},
})

type MarketplaceContextProviderProps = {
  children: ReactNode
}

export function useMarketplaceContext(selector: (value: MarketplaceContextValue) => any) {
  return useContextSelector(MarketplaceContext, selector)
}

export const MarketplaceContextProvider = ({
  children,
}: MarketplaceContextProviderProps) => {
  const [intersected, setIntersected] = useState(true)
  const [searchPluginText, setSearchPluginText] = useState('')
  const [filterPluginTags, setFilterPluginTags] = useState<string[]>([])
  const [activePluginType, setActivePluginType] = useState(PLUGIN_TYPE_SEARCH_MAP.all)
  const [plugins, setPlugins] = useState<Plugin[]>()
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [marketplaceCollectionsFromClient, setMarketplaceCollectionsFromClient] = useState<MarketplaceCollection[] | undefined>(undefined)
  const [marketplaceCollectionPluginsMapFromClient, setMarketplaceCollectionPluginsMapFromClient] = useState<Record<string, Plugin[]> | undefined>(undefined)

  const handleUpdatePlugins = useCallback(async (query: PluginsSearchParams) => {
    const { marketplacePlugins } = await getMarketplacePlugins(query)

    setPlugins(marketplacePlugins)
    setMarketplaceCollectionsFromClient(undefined)
    setMarketplaceCollectionPluginsMapFromClient(undefined)
  }, [])

  const handleUpdateMarketplaceCollectionsAndPlugins = useCallback(async (query?: CollectionsAndPluginsSearchParams) => {
    const {
      marketplaceCollections,
      marketplaceCollectionPluginsMap,
    } = await getMarketplaceCollectionsAndPlugins(query)

    setMarketplaceCollectionsFromClient(marketplaceCollections)
    setMarketplaceCollectionPluginsMapFromClient(marketplaceCollectionPluginsMap)
    setPlugins(undefined)
  }, [])

  const { run: handleUpdatePluginsWithDebounced } = useDebounceFn(handleUpdatePlugins, {
    wait: 500,
  })

  const handleSearchPluginTextChange = useCallback((text: string) => {
    setSearchPluginText(text)

    handleUpdatePluginsWithDebounced({
      query: text,
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      tags: filterPluginTags,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    })
  }, [handleUpdatePluginsWithDebounced, activePluginType, filterPluginTags, sort])

  const handleFilterPluginTagsChange = useCallback((tags: string[]) => {
    setFilterPluginTags(tags)

    handleUpdatePlugins({
      query: searchPluginText,
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      tags,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    })
  }, [handleUpdatePlugins, searchPluginText, activePluginType, sort])

  const handleActivePluginTypeChange = useCallback((type: string) => {
    setActivePluginType(type)

    if (!searchPluginText && !filterPluginTags.length) {
      handleUpdateMarketplaceCollectionsAndPlugins({
        category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
      })

      return
    }

    handleUpdatePlugins({
      query: searchPluginText,
      category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
      tags: filterPluginTags,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    })
  }, [handleUpdatePlugins, searchPluginText, filterPluginTags, sort, handleUpdateMarketplaceCollectionsAndPlugins])

  const handleSortChange = useCallback((sort: PluginsSort) => {
    setSort(sort)

    handleUpdatePlugins({
      query: searchPluginText,
      category: activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginType,
      tags: filterPluginTags,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    })
  }, [handleUpdatePlugins, searchPluginText, activePluginType, filterPluginTags])

  return (
    <MarketplaceContext.Provider
      value={{
        intersected,
        setIntersected,
        searchPluginText,
        handleSearchPluginTextChange,
        filterPluginTags,
        handleFilterPluginTagsChange,
        activePluginType,
        handleActivePluginTypeChange,
        plugins,
        setPlugins,
        sort,
        handleSortChange,
        marketplaceCollectionsFromClient,
        setMarketplaceCollectionsFromClient,
        marketplaceCollectionPluginsMapFromClient,
        setMarketplaceCollectionPluginsMapFromClient,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  )
}
