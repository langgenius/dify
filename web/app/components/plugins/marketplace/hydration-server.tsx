import type { SearchParams } from 'nuqs'
import type { CreatorSearchParams, PluginsSearchParams, TemplateSearchParams } from './types'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createLoader } from 'nuqs/server'
import { getQueryClientServer } from '@/context/query-client-server'
import { marketplaceQuery } from '@/service/client'
import {
  CATEGORY_ALL,
  DEFAULT_PLUGIN_SORT,
  DEFAULT_TEMPLATE_SORT,
  getValidatedPluginCategory,
  getValidatedTemplateCategory,
  PLUGIN_CATEGORY_WITH_COLLECTIONS,
  PLUGIN_TYPE_SEARCH_MAP,
} from './constants'
import { CREATION_TYPE, marketplaceSearchParamsParsers, SEARCH_TABS } from './search-params'
import {
  getCollectionsParams,
  getMarketplaceCollectionsAndPlugins,
  getMarketplaceCreators,
  getMarketplacePlugins,
  getMarketplaceTemplateCollectionsAndTemplates,
  getMarketplaceTemplates,
  getPluginFilterType,
} from './utils'

export type Awaitable<T> = T | PromiseLike<T>

const ZERO_WIDTH_SPACE = '\u200B'
const SEARCH_PREVIEW_SIZE = 8
const SEARCH_PAGE_SIZE = 40

const loadSearchParams = createLoader(marketplaceSearchParamsParsers)

function pickFirstParam(value: string | string[] | undefined) {
  if (Array.isArray(value))
    return value[0]
  return value
}

function getNextPageParam(lastPage: { page: number, page_size: number, total: number }) {
  const nextPage = lastPage.page + 1
  const loaded = lastPage.page * lastPage.page_size
  return loaded < (lastPage.total || 0) ? nextPage : undefined
}

type RouteParams = { category?: string, creationType?: string, searchTab?: string } | undefined

async function getDehydratedState(
  params?: Awaitable<RouteParams>,
  searchParams?: Awaitable<SearchParams>,
) {
  const rawParams = params ? await params : undefined
  const rawSearchParams = searchParams ? await searchParams : undefined
  const parsedSearchParams = await loadSearchParams(Promise.resolve(rawSearchParams ?? {}))

  const routeState = rawSearchParams as SearchParams & {
    category?: string | string[]
    creationType?: string | string[]
    searchTab?: string | string[]
  }

  const creationTypeFromSearch = pickFirstParam(routeState?.creationType)
  const categoryFromSearch = pickFirstParam(routeState?.category)
  const searchTabFromSearch = pickFirstParam(routeState?.searchTab)

  const creationType = rawParams?.creationType === CREATION_TYPE.templates || creationTypeFromSearch === CREATION_TYPE.templates
    ? CREATION_TYPE.templates
    : CREATION_TYPE.plugins
  const category = creationType === CREATION_TYPE.templates
    ? getValidatedTemplateCategory(rawParams?.category ?? categoryFromSearch ?? CATEGORY_ALL)
    : getValidatedPluginCategory(rawParams?.category ?? categoryFromSearch ?? CATEGORY_ALL)
  const searchTabRaw = rawParams?.searchTab ?? searchTabFromSearch ?? ''
  const searchTab = SEARCH_TABS.includes(searchTabRaw as (typeof SEARCH_TABS)[number])
    ? searchTabRaw as (typeof SEARCH_TABS)[number]
    : ''

  const queryClient = getQueryClientServer()
  const prefetches: Promise<void>[] = []

  if (searchTab) {
    const searchText = parsedSearchParams.q
    const query = searchText === ZERO_WIDTH_SPACE ? '' : searchText.trim()
    const hasQuery = !!searchText && (!!query || searchText === ZERO_WIDTH_SPACE)

    if (!hasQuery)
      return

    const pageSize = searchTab === 'all' ? SEARCH_PREVIEW_SIZE : SEARCH_PAGE_SIZE
    const searchFilterType = getValidatedPluginCategory(parsedSearchParams.searchType)
    const fetchPlugins = searchTab === 'all' || searchTab === 'plugins'
    const fetchTemplates = searchTab === 'all' || searchTab === 'templates'
    const fetchCreators = searchTab === 'all' || searchTab === 'creators'

    if (fetchPlugins) {
      const pluginCategory = searchTab === 'plugins' && searchFilterType !== CATEGORY_ALL
        ? searchFilterType
        : undefined
      const searchFilterTags = searchTab === 'plugins' && parsedSearchParams.searchTags.length > 0
        ? parsedSearchParams.searchTags
        : undefined
      const pluginsParams: PluginsSearchParams = {
        query,
        page_size: pageSize,
        sort_by: DEFAULT_PLUGIN_SORT.sortBy,
        sort_order: DEFAULT_PLUGIN_SORT.sortOrder,
        category: pluginCategory,
        tags: searchFilterTags,
        type: getPluginFilterType(pluginCategory || PLUGIN_TYPE_SEARCH_MAP.all),
      }

      prefetches.push(queryClient.prefetchInfiniteQuery({
        queryKey: marketplaceQuery.plugins.searchAdvanced.queryKey({
          input: {
            body: pluginsParams,
            params: { kind: pluginsParams.type === 'bundle' ? 'bundles' : 'plugins' },
          },
        }),
        queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(pluginsParams, pageParam, signal),
        getNextPageParam,
        initialPageParam: 1,
      }))
    }

    if (fetchTemplates) {
      const templateCategories = searchTab === 'templates' && parsedSearchParams.searchCategories.length > 0
        ? parsedSearchParams.searchCategories
        : undefined
      const templateLanguages = searchTab === 'templates' && parsedSearchParams.searchLanguages.length > 0
        ? parsedSearchParams.searchLanguages
        : undefined
      const templatesParams: TemplateSearchParams = {
        query,
        page_size: pageSize,
        sort_by: DEFAULT_TEMPLATE_SORT.sortBy,
        sort_order: DEFAULT_TEMPLATE_SORT.sortOrder,
        categories: templateCategories,
        languages: templateLanguages,
      }

      prefetches.push(queryClient.prefetchInfiniteQuery({
        queryKey: marketplaceQuery.templates.searchAdvanced.queryKey({
          input: {
            body: templatesParams,
          },
        }),
        queryFn: ({ pageParam = 1, signal }) => getMarketplaceTemplates(templatesParams, pageParam, signal),
        getNextPageParam,
        initialPageParam: 1,
      }))
    }

    if (fetchCreators) {
      const creatorsParams: CreatorSearchParams = {
        query,
        page_size: pageSize,
      }

      prefetches.push(queryClient.prefetchInfiniteQuery({
        queryKey: marketplaceQuery.creators.searchAdvanced.queryKey({
          input: {
            body: creatorsParams,
          },
        }),
        queryFn: ({ pageParam = 1, signal }) => getMarketplaceCreators(creatorsParams, pageParam, signal),
        getNextPageParam,
        initialPageParam: 1,
      }))
    }
  }
  else if (creationType === CREATION_TYPE.templates) {
    prefetches.push(queryClient.prefetchQuery({
      queryKey: marketplaceQuery.templateCollections.list.queryKey({ input: { query: undefined } }),
      queryFn: () => getMarketplaceTemplateCollectionsAndTemplates(),
    }))

    const isSearchMode = !!parsedSearchParams.q || category !== CATEGORY_ALL

    if (isSearchMode) {
      const templatesParams: TemplateSearchParams = {
        query: parsedSearchParams.q,
        categories: category === CATEGORY_ALL ? undefined : [category],
        sort_by: DEFAULT_TEMPLATE_SORT.sortBy,
        sort_order: DEFAULT_TEMPLATE_SORT.sortOrder,
      }

      prefetches.push(queryClient.prefetchInfiniteQuery({
        queryKey: marketplaceQuery.templates.searchAdvanced.queryKey({
          input: {
            body: templatesParams,
          },
        }),
        queryFn: ({ pageParam = 1, signal }) => getMarketplaceTemplates(templatesParams, pageParam, signal),
        getNextPageParam,
        initialPageParam: 1,
      }))
    }
  }
  else {
    const pluginCategory = getValidatedPluginCategory(category)
    const collectionsParams = getCollectionsParams(pluginCategory)

    prefetches.push(queryClient.prefetchQuery({
      queryKey: marketplaceQuery.plugins.collections.queryKey({ input: { query: collectionsParams } }),
      queryFn: () => getMarketplaceCollectionsAndPlugins(collectionsParams),
    }))

    const isSearchMode = !!parsedSearchParams.q
      || parsedSearchParams.tags.length > 0
      || !PLUGIN_CATEGORY_WITH_COLLECTIONS.has(pluginCategory)

    if (isSearchMode) {
      const pluginsParams: PluginsSearchParams = {
        query: parsedSearchParams.q,
        category: pluginCategory === CATEGORY_ALL ? undefined : pluginCategory,
        tags: parsedSearchParams.tags,
        sort_by: DEFAULT_PLUGIN_SORT.sortBy,
        sort_order: DEFAULT_PLUGIN_SORT.sortOrder,
        type: getPluginFilterType(pluginCategory),
      }

      prefetches.push(queryClient.prefetchInfiniteQuery({
        queryKey: marketplaceQuery.plugins.searchAdvanced.queryKey({
          input: {
            body: pluginsParams,
            params: { kind: pluginsParams.type === 'bundle' ? 'bundles' : 'plugins' },
          },
        }),
        queryFn: ({ pageParam = 1, signal }) => getMarketplacePlugins(pluginsParams, pageParam, signal),
        getNextPageParam,
        initialPageParam: 1,
      }))
    }
  }

  if (!prefetches.length)
    return

  await Promise.all(prefetches)
  return dehydrate(queryClient)
}

export async function HydrateQueryClient({
  params,
  searchParams,
  children,
}: {
  params?: Awaitable<{ category?: string, creationType?: string, searchTab?: string } | undefined>
  searchParams?: Awaitable<SearchParams>
  children: React.ReactNode
}) {
  const dehydratedState = await getDehydratedState(params, searchParams)

  return (
    <HydrationBoundary state={dehydratedState}>
      {children}
    </HydrationBoundary>
  )
}
