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
import type { PluginDetail } from '../types'
import type { FilterState } from './filter-management'
import { useTranslation } from 'react-i18next'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'

export type PluginPageContextValue = {
  containerRef: React.RefObject<HTMLDivElement>
  currentPluginDetail: PluginDetail | undefined
  setCurrentPluginDetail: (plugin: PluginDetail) => void
  filters: FilterState
  setFilters: (filter: FilterState) => void
  activeTab: string
  setActiveTab: (tab: string) => void
  options: Array<{ value: string, text: string }>
}

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: { current: null },
  currentPluginDetail: undefined,
  setCurrentPluginDetail: () => { },
  filters: {
    categories: [],
    tags: [],
    searchQuery: '',
  },
  setFilters: () => { },
  activeTab: '',
  setActiveTab: () => { },
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
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    tags: [],
    searchQuery: '',
  })
  const [currentPluginDetail, setCurrentPluginDetail] = useState<PluginDetail | undefined>()

  const { enable_marketplace } = useAppContextSelector(s => s.systemFeatures)
  const options = useMemo(() => {
    return [
      { value: 'plugins', text: t('common.menus.plugins') },
      ...(
        enable_marketplace
          ? [{ value: 'discover', text: 'Explore Marketplace' }]
          : []
      ),
    ]
  }, [t, enable_marketplace])
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: options[0].value,
  })

  return (
    <PluginPageContext.Provider
      value={{
        containerRef,
        currentPluginDetail,
        setCurrentPluginDetail,
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
