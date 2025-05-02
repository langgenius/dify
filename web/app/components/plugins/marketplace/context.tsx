'use client'

import type {
  ReactNode,
} from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
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
  SearchParamsFromCollection,
} from './types'
import { DEFAULT_SORT } from './constants'
import {
  useMarketplaceCollectionsAndPlugins,
  useMarketplaceContainerScroll,
  useMarketplacePlugins,
} from './hooks'
import {
  getMarketplaceListCondition,
  getMarketplaceListFilterType,
} from './utils'
import { useInstalledPluginList } from '@/service/use-plugins'

export type MarketplaceContextValue = {
  intersected: boolean
  setIntersected: (intersected: boolean) => void
  searchPluginText: string
  handleSearchPluginTextChange: (text: string) => void
  filterPluginTags: string[]
  handleFilterPluginTagsChange: (tags: string[]) => void
  activePluginType: string
  handleActivePluginTypeChange: (type: string) => void
  page: number
  handlePageChange: (page: number) => void
  plugins?: Plugin[]
  pluginsTotal?: number
  resetPlugins: () => void
  sort: PluginsSort
  handleSortChange: (sort: PluginsSort) => void
  handleQueryPlugins: () => void
  handleMoreClick: (searchParams: SearchParamsFromCollection) => void
  marketplaceCollectionsFromClient?: MarketplaceCollection[]
  setMarketplaceCollectionsFromClient: (collections: MarketplaceCollection[]) => void
  marketplaceCollectionPluginsMapFromClient?: Record<string, Plugin[]>
  setMarketplaceCollectionPluginsMapFromClient: (map: Record<string, Plugin[]>) => void
  isLoading: boolean
  isSuccessCollections: boolean
}

export const MarketplaceContext = createContext<MarketplaceContextValue>({
  intersected: true,
  setIntersected: () => {},
  searchPluginText: '',
  handleSearchPluginTextChange: () => {},
  filterPluginTags: [],
  handleFilterPluginTagsChange: () => {},
  activePluginType: 'all',
  handleActivePluginTypeChange: () => {},
  page: 1,
  handlePageChange: () => {},
  plugins: undefined,
  pluginsTotal: 0,
  resetPlugins: () => {},
  sort: DEFAULT_SORT,
  handleSortChange: () => {},
  handleQueryPlugins: () => {},
  handleMoreClick: () => {},
  marketplaceCollectionsFromClient: [],
  setMarketplaceCollectionsFromClient: () => {},
  marketplaceCollectionPluginsMapFromClient: {},
  setMarketplaceCollectionPluginsMapFromClient: () => {},
  isLoading: false,
  isSuccessCollections: false,
})

type MarketplaceContextProviderProps = {
  children: ReactNode
  searchParams?: SearchParams
  shouldExclude?: boolean
  scrollContainerId?: string
}

export function useMarketplaceContext(selector: (value: MarketplaceContextValue) => any) {
  return useContextSelector(MarketplaceContext, selector)
}

export const MarketplaceContextProvider = ({
  children,
  searchParams,
  shouldExclude,
  scrollContainerId,
}: MarketplaceContextProviderProps) => {
  const { data, isSuccess } = useInstalledPluginList(!shouldExclude)
  const exclude = useMemo(() => {
    if (shouldExclude)
      return data?.plugins.map(plugin => plugin.plugin_id)
  }, [data?.plugins, shouldExclude])
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
  const [page, setPage] = useState(1)
  const pageRef = useRef(page)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const sortRef = useRef(sort)
  const {
    marketplaceCollections: marketplaceCollectionsFromClient,
    setMarketplaceCollections: setMarketplaceCollectionsFromClient,
    marketplaceCollectionPluginsMap: marketplaceCollectionPluginsMapFromClient,
    setMarketplaceCollectionPluginsMap: setMarketplaceCollectionPluginsMapFromClient,
    queryMarketplaceCollectionsAndPlugins,
    isLoading,
    isSuccess: isSuccessCollections,
  } = useMarketplaceCollectionsAndPlugins()
  const {
    plugins,
    total: pluginsTotal,
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
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
        page: pageRef.current,
      })
      history.pushState({}, '', `/${searchParams?.language ? `?language=${searchParams?.language}` : ''}`)
    }
    else {
      if (shouldExclude && isSuccess) {
        queryMarketplaceCollectionsAndPlugins({
          exclude,
          type: getMarketplaceListFilterType(activePluginTypeRef.current),
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryPlugins, queryMarketplaceCollectionsAndPlugins, isSuccess, exclude])

  const handleQueryMarketplaceCollectionsAndPlugins = useCallback(() => {
    queryMarketplaceCollectionsAndPlugins({
      category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
      condition: getMarketplaceListCondition(activePluginTypeRef.current),
      exclude,
      type: getMarketplaceListFilterType(activePluginTypeRef.current),
    })
    resetPlugins()
  }, [exclude, queryMarketplaceCollectionsAndPlugins, resetPlugins])

  const handleQueryPlugins = useCallback((debounced?: boolean) => {
    if (debounced) {
      queryPluginsWithDebounced({
        query: searchPluginTextRef.current,
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
        tags: filterPluginTagsRef.current,
        sortBy: sortRef.current.sortBy,
        sortOrder: sortRef.current.sortOrder,
        exclude,
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
        page: pageRef.current,
      })
    }
    else {
      queryPlugins({
        query: searchPluginTextRef.current,
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
        tags: filterPluginTagsRef.current,
        sortBy: sortRef.current.sortBy,
        sortOrder: sortRef.current.sortOrder,
        exclude,
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
        page: pageRef.current,
      })
    }
  }, [exclude, queryPluginsWithDebounced, queryPlugins])

  const handleQuery = useCallback((debounced?: boolean) => {
    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      handleQueryMarketplaceCollectionsAndPlugins()
      return
    }

    handleQueryPlugins(debounced)
  }, [handleQueryMarketplaceCollectionsAndPlugins, handleQueryPlugins])

  const handleSearchPluginTextChange = useCallback((text: string) => {
    setSearchPluginText(text)
    searchPluginTextRef.current = text
    setPage(1)
    pageRef.current = 1

    handleQuery(true)
  }, [handleQuery])

  const handleFilterPluginTagsChange = useCallback((tags: string[]) => {
    setFilterPluginTags(tags)
    filterPluginTagsRef.current = tags
    setPage(1)
    pageRef.current = 1

    handleQuery()
  }, [handleQuery])

  const handleActivePluginTypeChange = useCallback((type: string) => {
    setActivePluginType(type)
    activePluginTypeRef.current = type
    setPage(1)
    pageRef.current = 1
  }, [])

  useEffect(() => {
    handleQuery()
  }, [activePluginType, handleQuery])

  const handleSortChange = useCallback((sort: PluginsSort) => {
    setSort(sort)
    sortRef.current = sort
    setPage(1)
    pageRef.current = 1

    handleQueryPlugins()
  }, [handleQueryPlugins])

  const handlePageChange = useCallback(() => {
    if (pluginsTotal && plugins && pluginsTotal > plugins.length) {
      setPage(pageRef.current + 1)
      pageRef.current++

      handleQueryPlugins()
    }
  }, [handleQueryPlugins, plugins, pluginsTotal])

  const handleMoreClick = useCallback((searchParams: SearchParamsFromCollection) => {
    setSearchPluginText(searchParams?.query || '')
    searchPluginTextRef.current = searchParams?.query || ''
    setSort({
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    })
    sortRef.current = {
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    }
    setPage(1)
    pageRef.current = 1

    handleQueryPlugins()
  }, [handleQueryPlugins])

  useMarketplaceContainerScroll(handlePageChange, scrollContainerId)

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
        page,
        handlePageChange,
        plugins,
        pluginsTotal,
        resetPlugins,
        sort,
        handleSortChange,
        handleQueryPlugins,
        handleMoreClick,
        marketplaceCollectionsFromClient,
        setMarketplaceCollectionsFromClient,
        marketplaceCollectionPluginsMapFromClient,
        setMarketplaceCollectionPluginsMapFromClient,
        isLoading: isLoading || isPluginsLoading,
        isSuccessCollections,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  )
}
