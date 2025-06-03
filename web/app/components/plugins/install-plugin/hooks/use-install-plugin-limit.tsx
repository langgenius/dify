import { useGlobalPublicStore } from '@/context/global-public-context'
import { InstallationScope } from '@/types/feature'
import type { Plugin, PluginManifestInMarket } from '../../types'

export default function usePluginInstallLimit(plugin: Plugin | PluginManifestInMarket) {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  if (systemFeatures.plugin_installation_permission.restrict_to_marketplace_only) {
    return { canInstall: false }
  }
  else {
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
    const verification = plugin.verification
    if (plugin.verification && !plugin.verification.authorized_category)
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
}
