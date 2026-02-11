import type { SearchTab } from './search-params'
import type { PluginsSort, SearchParamsFromCollection } from './types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { CATEGORY_ALL, DEFAULT_PLUGIN_SORT, DEFAULT_TEMPLATE_SORT, getValidatedPluginCategory, getValidatedTemplateCategory, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { CREATION_TYPE, marketplaceSearchParamsParsers } from './search-params'

const marketplacePluginSortAtom = atom<PluginsSort>(DEFAULT_PLUGIN_SORT)
export function useMarketplacePluginSort() {
  return useAtom(marketplacePluginSortAtom)
}
export function useMarketplacePluginSortValue() {
  return useAtomValue(marketplacePluginSortAtom)
}
export function useSetMarketplacePluginSort() {
  return useSetAtom(marketplacePluginSortAtom)
}

const marketplaceTemplateSortAtom = atom<PluginsSort>(DEFAULT_TEMPLATE_SORT)
export function useMarketplaceTemplateSort() {
  return useAtom(marketplaceTemplateSortAtom)
}
export function useMarketplaceTemplateSortValue() {
  return useAtomValue(marketplaceTemplateSortAtom)
}
export function useSetMarketplaceTemplateSort() {
  return useSetAtom(marketplaceTemplateSortAtom)
}

export function useSearchText() {
  return useQueryState('q', marketplaceSearchParamsParsers.q)
}
export function useActivePluginCategory() {
  const [category, setCategory] = useQueryState('category', marketplaceSearchParamsParsers.category)
  return [getValidatedPluginCategory(category), setCategory] as const
}

export function useActiveTemplateCategory() {
  const [category, setCategory] = useQueryState('category', marketplaceSearchParamsParsers.category)
  return [getValidatedTemplateCategory(category), setCategory] as const
}
export function useFilterPluginTags() {
  return useQueryState('tags', marketplaceSearchParamsParsers.tags)
}

export function useSearchTab() {
  return useQueryState('searchTab', marketplaceSearchParamsParsers.searchTab)
}

export function useCreationType() {
  return useQueryState('creationType', marketplaceSearchParamsParsers.creationType)
}

/**
 * Not all categories have collections, so we need to
 * force the search mode for those categories.
 */
export const searchModeAtom = atom<true | null>(null)

export function useMarketplaceSearchMode() {
  const [creationType] = useCreationType()
  const [searchText] = useSearchText()
  const [searchTab] = useSearchTab()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginCategory] = useActivePluginCategory()
  const [activeTemplateCategory] = useActiveTemplateCategory()
  const isPluginsView = creationType === CREATION_TYPE.plugins

  const searchMode = useAtomValue(searchModeAtom)
  const isSearchMode = searchTab || searchText
    || (isPluginsView && filterPluginTags.length > 0)
    || (searchMode ?? (isPluginsView && !PLUGIN_CATEGORY_WITH_COLLECTIONS.has(activePluginCategory)))
    || (!isPluginsView && activeTemplateCategory !== CATEGORY_ALL)
  return isSearchMode
}

/**
 * Returns the active sort state based on the current creationType.
 * Plugins use `marketplacePluginSortAtom`, templates use `marketplaceTemplateSortAtom`.
 */
export function useActiveSort(): [PluginsSort, (sort: PluginsSort) => void] {
  const [creationType] = useCreationType()
  const [pluginSort, setPluginSort] = useAtom(marketplacePluginSortAtom)
  const [templateSort, setTemplateSort] = useAtom(marketplaceTemplateSortAtom)
  const isTemplates = creationType === CREATION_TYPE.templates

  const sort = isTemplates ? templateSort : pluginSort
  const setSort = useMemo(
    () => isTemplates ? setTemplateSort : setPluginSort,
    [isTemplates, setTemplateSort, setPluginSort],
  )
  return [sort, setSort]
}

export function useActiveSortValue(): PluginsSort {
  const [creationType] = useCreationType()
  const pluginSort = useAtomValue(marketplacePluginSortAtom)
  const templateSort = useAtomValue(marketplaceTemplateSortAtom)
  return creationType === CREATION_TYPE.templates ? templateSort : pluginSort
}

export function useMarketplaceMoreClick() {
  const [, setQ] = useSearchText()
  const [, setSearchTab] = useSearchTab()
  const setPluginSort = useSetAtom(marketplacePluginSortAtom)
  const setTemplateSort = useSetAtom(marketplaceTemplateSortAtom)
  const setSearchMode = useSetAtom(searchModeAtom)

  return useCallback((searchParams?: SearchParamsFromCollection, searchTab?: SearchTab) => {
    if (!searchParams)
      return
    setQ(searchParams?.query || '')
    if (searchTab === 'templates') {
      setTemplateSort({
        sortBy: searchParams?.sort_by || DEFAULT_TEMPLATE_SORT.sortBy,
        sortOrder: searchParams?.sort_order || DEFAULT_TEMPLATE_SORT.sortOrder,
      })
    }
    else {
      setPluginSort({
        sortBy: searchParams?.sort_by || DEFAULT_PLUGIN_SORT.sortBy,
        sortOrder: searchParams?.sort_order || DEFAULT_PLUGIN_SORT.sortOrder,
      })
    }
    setSearchMode(true)
    if (searchTab)
      setSearchTab(searchTab)
  }, [setQ, setSearchTab, setPluginSort, setTemplateSort, setSearchMode])
}
