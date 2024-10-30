'use client'

import type {
  ReactNode,
} from 'react'
import {
  useCallback,
  useRef,
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
  const searchPluginTextRef = useRef(searchPluginText)
  const [filterPluginTags, setFilterPluginTags] = useState<string[]>([])
  const filterPluginTagsRef = useRef(filterPluginTags)
  const [activePluginType, setActivePluginType] = useState(PLUGIN_TYPE_SEARCH_MAP.all)
  const activePluginTypeRef = useRef(activePluginType)
  const [plugins, setPlugins] = useState<Plugin[]>()
  const [sort, setSort] = useState(DEFAULT_SORT)
  const sortRef = useRef(sort)
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
    searchPluginTextRef.current = text

    handleUpdatePluginsWithDebounced({
      query: text,
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      tags: filterPluginTagsRef.current,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [handleUpdatePluginsWithDebounced])

  const handleFilterPluginTagsChange = useCallback((tags: string[]) => {
    setFilterPluginTags(tags)
    filterPluginTagsRef.current = tags

    handleUpdatePlugins({
      query: searchPluginTextRef.current,
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      tags,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [handleUpdatePlugins])

  const handleActivePluginTypeChange = useCallback((type: string) => {
    setActivePluginType(type)
    activePluginTypeRef.current = type

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      handleUpdateMarketplaceCollectionsAndPlugins({
        category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
      })

      return
    }

    handleUpdatePlugins({
      query: searchPluginTextRef.current,
      category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
      tags: filterPluginTagsRef.current,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [handleUpdatePlugins, handleUpdateMarketplaceCollectionsAndPlugins])

  const handleSortChange = useCallback((sort: PluginsSort) => {
    setSort(sort)
    sortRef.current = sort

    handleUpdatePlugins({
      query: searchPluginTextRef.current,
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      tags: filterPluginTagsRef.current,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [handleUpdatePlugins])

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
