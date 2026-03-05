'use client'

import type { ReactNode } from 'react'
import type { PluginPageTab } from './context'
import type { FilterState } from './filter-management'
import { parseAsStringEnum, useQueryState } from 'nuqs'
import {
  useMemo,
  useRef,
  useState,
} from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { PLUGIN_PAGE_TABS_MAP, usePluginPageTabs } from '../hooks'
import { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/constants'
import {
  PluginPageContext,
} from './context'

const PLUGIN_PAGE_TAB_VALUES: PluginPageTab[] = [
  PLUGIN_PAGE_TABS_MAP.plugins,
  PLUGIN_PAGE_TABS_MAP.marketplace,
  ...Object.values(PLUGIN_TYPE_SEARCH_MAP),
]

const parseAsPluginPageTab = parseAsStringEnum<PluginPageTab>(PLUGIN_PAGE_TAB_VALUES)
  .withDefault(PLUGIN_PAGE_TABS_MAP.plugins)

type PluginPageContextProviderProps = {
  children: ReactNode
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
