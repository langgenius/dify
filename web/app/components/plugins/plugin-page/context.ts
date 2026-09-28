'use client'

import type { RefObject } from 'react'
import type { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/constants'
import type { FilterState } from './filter-management'
import { noop } from 'es-toolkit/function'
import { createContext, useContextSelector } from 'use-context-selector'
import { PLUGIN_PAGE_TABS_MAP } from '../hooks'

export type PluginPageTab =
  | (typeof PLUGIN_PAGE_TABS_MAP)[keyof typeof PLUGIN_PAGE_TABS_MAP]
  | (typeof PLUGIN_TYPE_SEARCH_MAP)[keyof typeof PLUGIN_TYPE_SEARCH_MAP]

export type PluginPageSelection =
  | { type: 'builtinTool'; id: string }
  | { type: 'plugin'; id: string }

type PluginPageContextValue = {
  containerRef: RefObject<HTMLDivElement | null>
  selectedItem: PluginPageSelection | undefined
  setSelectedItem: (item?: PluginPageSelection) => void
  filters: FilterState
  setFilters: (filter: FilterState) => void
  activeTab: PluginPageTab
  setActiveTab: (tab: PluginPageTab) => void
  options: Array<{ value: string; text: string }>
}

const emptyContainerRef: RefObject<HTMLDivElement | null> = { current: null }

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: emptyContainerRef,
  selectedItem: undefined,
  setSelectedItem: noop,
  filters: {
    categories: [],
    tags: [],
    searchQuery: '',
  },
  setFilters: noop,
  activeTab: PLUGIN_PAGE_TABS_MAP.plugins,
  setActiveTab: noop,
  options: [],
})

export function usePluginPageContext(selector: (value: PluginPageContextValue) => any) {
  return useContextSelector(PluginPageContext, selector)
}
