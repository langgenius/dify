'use client'

import type { ReactNode } from 'react'
import {
  useRef,
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'
import type { InstalledPlugin, Permissions } from '../types'
import type { FilterState } from './filter-management'
import { PermissionType } from '../types'
import { fetchInstalledPluginList } from '@/service/plugins'
import useSWR from 'swr'

export type PluginPageContextValue = {
  containerRef: React.RefObject<HTMLDivElement>
  permissions: Permissions
  setPermissions: (permissions: PluginPageContextValue['permissions']) => void
  installedPluginList: InstalledPlugin[]
  mutateInstalledPluginList: () => void
  filters: FilterState
  setFilters: (filter: FilterState) => void
}

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: { current: null },
  permissions: {
    install_permission: PermissionType.noOne,
    debug_permission: PermissionType.noOne,
  },
  setPermissions: () => { },
  installedPluginList: [],
  mutateInstalledPluginList: () => {},
  filters: {
    categories: [],
    tags: [],
    searchQuery: '',
  },
  setFilters: () => {},
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
  const [permissions, setPermissions] = useState<PluginPageContextValue['permissions']>({
    install_permission: PermissionType.noOne,
    debug_permission: PermissionType.noOne,
  })
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    tags: [],
    searchQuery: '',
  })
  const { data, mutate: mutateInstalledPluginList } = useSWR({ url: '/workspaces/current/plugin/list' }, fetchInstalledPluginList)

  return (
    <PluginPageContext.Provider
      value={{
        containerRef,
        permissions,
        setPermissions,
        installedPluginList: data?.plugins || [],
        mutateInstalledPluginList,
        filters,
        setFilters,
      }}
    >
      {children}
    </PluginPageContext.Provider>
  )
}
