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
import type { Permissions } from '../types'
import { PermissionType } from '../types'

export type PluginPageContextValue = {
  containerRef: React.RefObject<HTMLDivElement>
  permissions: Permissions
  setPermissions: (permissions: PluginPageContextValue['permissions']) => void

}

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: { current: null },
  permissions: {
    install_permission: PermissionType.noOne,
    debug_permission: PermissionType.noOne,
  },
  setPermissions: () => { },
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

  return (
    <PluginPageContext.Provider
      value={{
        containerRef,
        permissions,
        setPermissions,
      }}
    >
      {children}
    </PluginPageContext.Provider>
  )
}
