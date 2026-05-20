'use client'

import type { ReactNode } from 'react'
import type { PluginInstallPermissionStore } from '../hooks/use-plugin-install-permission'
import { use, useEffect, useRef } from 'react'
import {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
} from '../hooks/use-plugin-install-permission'

type PluginInstallPermissionProviderProps = {
  canInstallPlugin: boolean
  currentDifyVersion?: string
  children: ReactNode
}

export const PluginInstallPermissionProvider = ({
  canInstallPlugin,
  currentDifyVersion,
  children,
}: PluginInstallPermissionProviderProps) => {
  const storeRef = useRef<PluginInstallPermissionStore | null>(null)

  if (!storeRef.current) {
    storeRef.current = createPluginInstallPermissionStore({
      canInstallPlugin,
      currentDifyVersion,
    })
  }

  useEffect(() => {
    storeRef.current?.getState().setPluginInstallPermission({
      canInstallPlugin,
      currentDifyVersion,
    })
  }, [canInstallPlugin, currentDifyVersion])

  return (
    <PluginInstallPermissionContext value={storeRef.current}>
      {children}
    </PluginInstallPermissionContext>
  )
}

export const PluginInstallPermissionProviderGuard = ({
  canInstallPlugin,
  currentDifyVersion,
  children,
}: PluginInstallPermissionProviderProps) => {
  const store = use(PluginInstallPermissionContext)

  if (store)
    return children

  return (
    <PluginInstallPermissionProvider
      canInstallPlugin={canInstallPlugin}
      currentDifyVersion={currentDifyVersion}
    >
      {children}
    </PluginInstallPermissionProvider>
  )
}
