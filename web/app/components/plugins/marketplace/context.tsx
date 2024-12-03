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
} from './types'
import { DEFAULT_SORT } from './constants'
import {
  useMarketplaceCollectionsAndPlugins,
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
  resetPlugins: () => void
  sort: PluginsSort
  handleSortChange: (sort: PluginsSort) => void
  handleQueryPluginsWhenNoCollection: () => void
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
  resetPlugins: () => {},
  sort: DEFAULT_SORT,
  handleSortChange: () => {},
  handleQueryPluginsWhenNoCollection: () => {},
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
}

export function useMarketplaceContext(selector: (value: MarketplaceContextValue) => any) {
  return useContextSelector(MarketplaceContext, selector)
}

export const MarketplaceContextProvider = ({
  children,
  searchParams,
  shouldExclude,
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

  const handleSearchPluginTextChange = useCallback((text: string) => {
    setSearchPluginText(text)
    searchPluginTextRef.current = text
    setPage(1)
    pageRef.current = 1

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
        condition: getMarketplaceListCondition(activePluginTypeRef.current),
        exclude,
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
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
      exclude,
      page: pageRef.current,
    })
  }, [queryPluginsWithDebounced, queryMarketplaceCollectionsAndPlugins, resetPlugins, exclude])

  const handleFilterPluginTagsChange = useCallback((tags: string[]) => {
    setFilterPluginTags(tags)
    filterPluginTagsRef.current = tags
    setPage(1)
    pageRef.current = 1

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
        condition: getMarketplaceListCondition(activePluginTypeRef.current),
        exclude,
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
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
      exclude,
      type: getMarketplaceListFilterType(activePluginTypeRef.current),
      page: pageRef.current,
    })
  }, [queryPlugins, resetPlugins, queryMarketplaceCollectionsAndPlugins, exclude])

  const handleActivePluginTypeChange = useCallback((type: string) => {
    setActivePluginType(type)
    activePluginTypeRef.current = type
    setPage(1)
    pageRef.current = 1

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: type === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : type,
        condition: getMarketplaceListCondition(type),
        exclude,
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
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
      exclude,
      type: getMarketplaceListFilterType(activePluginTypeRef.current),
      page: pageRef.current,
    })
  }, [queryPlugins, resetPlugins, queryMarketplaceCollectionsAndPlugins, exclude])

  const handlePageChange = useCallback(() => {
    setPage(pageRef.current + 1)
    pageRef.current++

    if (!searchPluginTextRef.current && !filterPluginTagsRef.current.length) {
      queryMarketplaceCollectionsAndPlugins({
        category: activePluginTypeRef.current === PLUGIN_TYPE_SEARCH_MAP.all ? undefined : activePluginTypeRef.current,
        condition: getMarketplaceListCondition(activePluginTypeRef.current),
        exclude,
        type: getMarketplaceListFilterType(activePluginTypeRef.current),
      })
      resetPlugins()

      return
    }

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
  }, [exclude, queryPlugins, queryMarketplaceCollectionsAndPlugins, resetPlugins])

  const handleSortChange = useCallback((sort: PluginsSort) => {
    setSort(sort)
    sortRef.current = sort
    setPage(1)
    pageRef.current = 1

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
  }, [queryPlugins, exclude])

  const handleQueryPluginsWhenNoCollection = useCallback(() => {
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
  }, [exclude, queryPlugins])

  // useMarketplaceContainerScroll(handlePageChange)

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
        resetPlugins,
        sort,
        handleSortChange,
        handleQueryPluginsWhenNoCollection,
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
