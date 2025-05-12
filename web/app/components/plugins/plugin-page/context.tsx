'use client'

import type { ReactNode } from 'react'
import {
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import type { FilterState } from './filter-management'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import { noop } from 'lodash-es'
import { PLUGIN_PAGE_TABS_MAP, usePluginPageTabs } from '../hooks'

export type PluginPageContextValue = {
  containerRef: React.RefObject<HTMLDivElement>
  currentPluginID: string | undefined
  setCurrentPluginID: (pluginID?: string) => void
  filters: FilterState
  setFilters: (filter: FilterState) => void
  activeTab: string
  setActiveTab: (tab: string) => void
  options: Array<{ value: string, text: string }>
}

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: { current: null },
  currentPluginID: undefined,
  setCurrentPluginID: noop,
  filters: {
    categories: [],
    tags: [],
    searchQuery: '',
  },
  setFilters: noop,
  activeTab: '',
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
  const containerRef = useRef<HTMLDivElement>(null)
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    tags: [],
    searchQuery: '',
  })
  const [currentPluginID, setCurrentPluginID] = useState<string | undefined>()

  const { enable_marketplace } = useAppContextSelector(s => s.systemFeatures)
  const tabs = usePluginPageTabs()
  const options = useMemo(() => {
    return enable_marketplace ? tabs : tabs.filter(tab => tab.value !== PLUGIN_PAGE_TABS_MAP.marketplace)
  }, [tabs, enable_marketplace])
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: options[0].value,
  })

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
