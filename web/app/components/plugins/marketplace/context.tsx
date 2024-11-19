'use client'

import type {
  ReactNode,
} from 'react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'
import { PLUGIN_TYPE_SEARCH_MAP } from './plugin-type-switch'
import type { Plugin } from '../types'
import {
  getValidCategoryKeys,
  getValidTagKeys,
} from '../utils'
import type {
  MarketplaceCollection,
  PluginsSort,
  SearchParams,
} from './types'
import { DEFAULT_SORT } from './constants'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplacePlugins,
} from './hooks'

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
  resetPlugins: () => void
  sort: PluginsSort
  handleSortChange: (sort: PluginsSort) => void
  marketplaceCollectionsFromClient?: MarketplaceCollection[]
  setMarketplaceCollectionsFromClient: (collections: MarketplaceCollection[]) => void
  marketplaceCollectionPluginsMapFromClient?: Record<string, Plugin[]>
  setMarketplaceCollectionPluginsMapFromClient: (map: Record<string, Plugin[]>) => void
  isLoading: boolean
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
  resetPlugins: () => {},
  sort: DEFAULT_SORT,
  handleSortChange: () => {},
  marketplaceCollectionsFromClient: [],
  setMarketplaceCollectionsFromClient: () => {},
  marketplaceCollectionPluginsMapFromClient: {},
  setMarketplaceCollectionPluginsMapFromClient: () => {},
  isLoading: false,
})

type MarketplaceContextProviderProps = {
  children: ReactNode
  searchParams?: SearchParams
}

export function useMarketplaceContext(selector: (value: MarketplaceContextValue) => any) {
  return useContextSelector(MarketplaceContext, selector)
}

export const MarketplaceContextProvider = ({
  children,
  searchParams,
}: MarketplaceContextProviderProps) => {
  const queryFromSearchParams = searchParams?.q || ''
  const tagsFromSearchParams = searchParams?.tags ? getValidTagKeys(searchParams.tags.split(',')) : []
  const hasValidTags = !!tagsFromSearchParams.length
  const hasValidCategory = getValidCategoryKeys(searchParams?.category)
  const categoryFromSearchParams = hasValidCategory || PLUGIN_TYPE_SEARCH_MAP.all
  const [intersected, setIntersected] = useState(true)
  const [searchPluginText, setSearchPluginText] = useState(queryFromSearchParams)
  const searchPluginTextRef = useRef(searchPluginText)
  const [filterPluginTags, setFilterPluginTags] = useState<string[]>(tagsFromSearchParams)
  const filterPluginTagsRef = useRef(filterPluginTags)
  const [activePluginType, setActivePluginType] = useState(categoryFromSearchParams)
  const activePluginTypeRef = useRef(activePluginType)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const sortRef = useRef(sort)
  const {
    marketplaceCollections: marketplaceCollectionsFromClient,
    setMarketplaceCollections: setMarketplaceCollectionsFromClient,
    marketplaceCollectionPluginsMap: marketplaceCollectionPluginsMapFromClient,
    setMarketplaceCollectionPluginsMap: setMarketplaceCollectionPluginsMapFromClient,
    queryMarketplaceCollectionsAndPlugins,
    isLoading,
  } = useMarketplaceCollectionsAndPlugins()
  const {
    plugins,
    resetPlugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading: isPluginsLoading,
  } = useMarketplacePlugins()

  useEffect(() => {
    if (queryFromSearchParams || hasValidTags || hasValidCategory) {
      queryPlugins({
        query: queryFromSearchParams,
        category: hasValidCategory,
        tags: hasValidTags ? tagsFromSearchParams : [],
        sortBy: sortRef.current.sortBy,
        sortOrder: sortRef.current.sortOrder,
      })
      history.pushState({}, '', `/${searchParams?.language ? `?language=${searchParams?.language}` : ''}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryPlugins])

  const handleSearchPluginTextChange = useCallback((text: string) => {
    setSearchPluginText(text)
    searchPluginTextRef.current = text

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      })
      resetPlugins()

      return
    }

    queryPluginsWithDebounced({
      query: text,
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      tags: filterPluginTagsRef.current,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [queryPluginsWithDebounced, queryMarketplaceCollectionsAndPlugins, resetPlugins])

  const handleFilterPluginTagsChange = useCallback((tags: string[]) => {
    setFilterPluginTags(tags)
    filterPluginTagsRef.current = tags

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      })
      resetPlugins()

      return
    }

    queryPlugins({
      query: searchPluginTextRef.current,
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      tags,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [queryPlugins, resetPlugins, queryMarketplaceCollectionsAndPlugins])

  const handleActivePluginTypeChange = useCallback((type: string) => {
    setActivePluginType(type)
    activePluginTypeRef.current = type

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
      })
      resetPlugins()

      return
    }

    queryPlugins({
      query: searchPluginTextRef.current,
      category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
      tags: filterPluginTagsRef.current,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [queryPlugins, resetPlugins, queryMarketplaceCollectionsAndPlugins])

  const handleSortChange = useCallback((sort: PluginsSort) => {
    setSort(sort)
    sortRef.current = sort

    queryPlugins({
      query: searchPluginTextRef.current,
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      tags: filterPluginTagsRef.current,
      sortBy: sortRef.current.sortBy,
      sortOrder: sortRef.current.sortOrder,
    })
  }, [queryPlugins])

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
        resetPlugins,
        sort,
        handleSortChange,
        marketplaceCollectionsFromClient,
        setMarketplaceCollectionsFromClient,
        marketplaceCollectionPluginsMapFromClient,
        setMarketplaceCollectionPluginsMapFromClient,
        isLoading: isLoading || isPluginsLoading,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  )
}
