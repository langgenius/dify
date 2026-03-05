'use client'

import type { ReactNode, RefObject } from 'react'
import type { FilterState } from './filter-management'
import { noop } from 'es-toolkit/function'
import { parseAsStringEnum, useQueryState } from 'nuqs'
import {
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { PLUGIN_PAGE_TABS_MAP, usePluginPageTabs } from '../hooks'
import { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/constants'

export type PluginPageTab = typeof PLUGIN_PAGE_TABS_MAP[keyof typeof PLUGIN_PAGE_TABS_MAP]
  | (typeof PLUGIN_TYPE_SEARCH_MAP)[keyof typeof PLUGIN_TYPE_SEARCH_MAP]

const PLUGIN_PAGE_TAB_VALUES: PluginPageTab[] = [
  PLUGIN_PAGE_TABS_MAP.plugins,
  PLUGIN_PAGE_TABS_MAP.marketplace,
  ...Object.values(PLUGIN_TYPE_SEARCH_MAP),
]

const parseAsPluginPageTab = parseAsStringEnum<PluginPageTab>(PLUGIN_PAGE_TAB_VALUES)
  .withDefault(PLUGIN_PAGE_TABS_MAP.plugins)

export type PluginPageContextValue = {
  containerRef: RefObject<HTMLDivElement | null>
  currentPluginID: string | undefined
  setCurrentPluginID: (pluginID?: string) => void
  filters: FilterState
  setFilters: (filter: FilterState) => void
  activeTab: PluginPageTab
  setActiveTab: (tab: PluginPageTab) => void
  options: Array<{ value: string, text: string }>
}

const emptyContainerRef: RefObject<HTMLDivElement | null> = { current: null }

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: emptyContainerRef,
  currentPluginID: undefined,
  setCurrentPluginID: noop,
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

type PluginPageContextProviderProps = {
  children: ReactNode
}

export function usePluginPageContext(selector: (value: PluginPageContextValue) => any) {
  return useContextSelector(PluginPageContext, selector)
}

export const PluginPageContextProvider = ({
  children,
}: PluginPageContextProviderProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    tags: [],
    searchQuery: '',
  })
  const [currentPluginID, setCurrentPluginID] = useState<string | undefined>()

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const tabs = usePluginPageTabs()
  const options = useMemo(() => {
    return enable_marketplace ? tabs : tabs.filter(tab => tab.value !== PLUGIN_PAGE_TABS_MAP.marketplace)
  }, [tabs, enable_marketplace])
  const [activeTab, setActiveTab] = useQueryState('tab', parseAsPluginPageTab)

  return (
    <PluginPageContext.Provider
      value={{
        containerRef,
        currentPluginID,
        setCurrentPluginID,
        filters,
        setFilters,
        activeTab,
        setActiveTab,
        options,
      }}
    >
      {children}
    </PluginPageContext.Provider>
  )
}
