import type { Plugin, PluginManifestInMarket } from '../../types'
import type { SystemFeatures } from '@/types/feature'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { InstallationScope } from '@/types/feature'

type PluginProps = (Plugin | PluginManifestInMarket) & { from: 'github' | 'marketplace' | 'package' }

export function pluginInstallLimit(plugin: PluginProps, systemFeatures: SystemFeatures) {
  if (systemFeatures.plugin_installation_permission.restrict_to_marketplace_only) {
    if (plugin.from === 'github' || plugin.from === 'package')
      return { canInstall: false }
  }

  if (systemFeatures.plugin_installation_permission.plugin_installation_scope === InstallationScope.ALL) {
    return {
      canInstall: true,
    }
  }
  if (systemFeatures.plugin_installation_permission.plugin_installation_scope === InstallationScope.NONE) {
    return {
      canInstall: false,
    }
  }
  const verification = plugin.verification || {}
  if (!plugin.verification || !plugin.verification.authorized_category)
    verification.authorized_category = 'langgenius'

  if (systemFeatures.plugin_installation_permission.plugin_installation_scope === InstallationScope.OFFICIAL_ONLY) {
    return {
      canInstall: verification.authorized_category === 'langgenius',
    }
  }
  if (systemFeatures.plugin_installation_permission.plugin_installation_scope === InstallationScope.OFFICIAL_AND_PARTNER) {
    return {
      canInstall: verification.authorized_category === 'langgenius' || verification.authorized_category === 'partner',
    }
  }
  return {
    canInstall: true,
  }
}

export default function usePluginInstallLimit(plugin: PluginProps) {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  return pluginInstallLimit(plugin, systemFeatures)
}
