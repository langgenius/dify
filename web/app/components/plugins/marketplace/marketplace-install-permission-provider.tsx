'use client'

import type { ReactNode } from 'react'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import { useAppContext } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'

type MarketplaceInstallPermissionProviderProps = {
  children: ReactNode
}

const MarketplaceInstallPermissionProvider = ({
  children,
}: MarketplaceInstallPermissionProviderProps) => {
  const { workspacePermissionKeys } = useAppContext()
  const canInstallPlugin = hasPermission(workspacePermissionKeys, 'plugin.install')

  return (
    <PluginInstallPermissionProvider canInstallPlugin={canInstallPlugin}>
      {children}
    </PluginInstallPermissionProvider>
  )
}

export default MarketplaceInstallPermissionProvider
