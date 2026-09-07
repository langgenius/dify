'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

type MarketplaceInstallPermissionProviderProps = {
  children: ReactNode
}

const MarketplaceInstallPermissionProvider = ({
  children,
}: MarketplaceInstallPermissionProviderProps) => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canInstallPlugin = hasPermission(workspacePermissionKeys, 'plugin.install')

  return (
    <PluginInstallPermissionProvider canInstallPlugin={canInstallPlugin}>
      {children}
    </PluginInstallPermissionProvider>
  )
}

export default MarketplaceInstallPermissionProvider
