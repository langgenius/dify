'use client'

import type { ReactNode } from 'react'
import { use, useEffect, useState } from 'react'
import {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
} from '../hooks/use-plugin-install-permission'

type PluginInstallPermissionProviderProps = {
  canInstallPlugin: boolean
  canUpdatePlugin?: boolean
  currentDifyVersion?: string
  children: ReactNode
}

export const PluginInstallPermissionProvider = ({
  canInstallPlugin,
  canUpdatePlugin,
  currentDifyVersion,
  children,
}: PluginInstallPermissionProviderProps) => {
  const [store] = useState(() =>
    createPluginInstallPermissionStore({
      canInstallPlugin,
      canUpdatePlugin,
      currentDifyVersion,
    }),
  )

  useEffect(() => {
    store.getState().setPluginInstallPermission({
      canInstallPlugin,
      canUpdatePlugin: canUpdatePlugin ?? canInstallPlugin,
      currentDifyVersion,
    })
  }, [canInstallPlugin, canUpdatePlugin, currentDifyVersion, store])

  return <PluginInstallPermissionContext value={store}>{children}</PluginInstallPermissionContext>
}

export const PluginInstallPermissionProviderGuard = ({
  canInstallPlugin,
  canUpdatePlugin,
  currentDifyVersion,
  children,
}: PluginInstallPermissionProviderProps) => {
  const store = use(PluginInstallPermissionContext)

  if (store) return children

  return (
    <PluginInstallPermissionProvider
      canInstallPlugin={canInstallPlugin}
      canUpdatePlugin={canUpdatePlugin}
      currentDifyVersion={currentDifyVersion}
    >
      {children}
    </PluginInstallPermissionProvider>
  )
}
