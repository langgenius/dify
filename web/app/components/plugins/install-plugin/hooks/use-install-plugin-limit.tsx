import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { Plugin, PluginManifestInMarket } from '../../types'
import { useQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { InstallationScope } from '@/features/system-features/constants'

type PluginProps = (Plugin | PluginManifestInMarket) & {
  from: 'github' | 'marketplace' | 'package'
}
type PluginInstallLimitResult = {
  canInstall: boolean
  isLoading: boolean
}

export function pluginInstallLimit(plugin: PluginProps, systemFeatures: GetSystemFeaturesResponse) {
  if (systemFeatures.plugin_installation_permission.restrict_to_marketplace_only) {
    if (plugin.from === 'github' || plugin.from === 'package') return { canInstall: false }
  }

  if (
    systemFeatures.plugin_installation_permission.plugin_installation_scope ===
    InstallationScope.ALL
  ) {
    return {
      canInstall: true,
    }
  }
  if (
    systemFeatures.plugin_installation_permission.plugin_installation_scope ===
    InstallationScope.NONE
  ) {
    return {
      canInstall: false,
    }
  }
  const verification = plugin.verification || {}
  if (!plugin.verification || !plugin.verification.authorized_category)
    verification.authorized_category = 'langgenius'

  if (
    systemFeatures.plugin_installation_permission.plugin_installation_scope ===
    InstallationScope.OFFICIAL_ONLY
  ) {
    return {
      canInstall: verification.authorized_category === 'langgenius',
    }
  }
  if (
    systemFeatures.plugin_installation_permission.plugin_installation_scope ===
    InstallationScope.OFFICIAL_AND_PARTNER
  ) {
    return {
      canInstall:
        verification.authorized_category === 'langgenius' ||
        verification.authorized_category === 'partner',
    }
  }
  return {
    canInstall: true,
  }
}

export default function usePluginInstallLimit(plugin: PluginProps): PluginInstallLimitResult {
  const { data: systemFeatures, isPending } = useQuery(systemFeaturesQueryOptions())
  if (!systemFeatures) {
    return {
      canInstall: false,
      isLoading: isPending,
    }
  }

  return {
    ...pluginInstallLimit(plugin, systemFeatures),
    isLoading: false,
  }
}
