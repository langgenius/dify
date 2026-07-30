import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type {
  PluginBundleDependencyType,
  PluginVerification,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { InstallationScope } from '@/features/system-features/constants'

type PluginInstallCandidate = {
  from: PluginBundleDependencyType
  verification?: PluginVerification | null
}
type PluginInstallLimitResult = {
  canInstall: boolean
}

function denyUnsupportedInstallationScope(_scope: never): PluginInstallLimitResult {
  return { canInstall: false }
}

export function pluginInstallLimit(
  plugin: PluginInstallCandidate,
  systemFeatures: Pick<GetSystemFeaturesResponse, 'plugin_installation_permission'>,
) {
  const permission = systemFeatures.plugin_installation_permission
  if (permission.restrict_to_marketplace_only) {
    if (plugin.from === 'github' || plugin.from === 'package') return { canInstall: false }
  }

  const authorizedCategory = plugin.verification?.authorized_category ?? 'langgenius'
  const scope = permission.plugin_installation_scope

  switch (scope) {
    case InstallationScope.ALL:
      return { canInstall: true }
    case InstallationScope.NONE:
      return { canInstall: false }
    case InstallationScope.OFFICIAL_ONLY:
      return { canInstall: authorizedCategory === 'langgenius' }
    case InstallationScope.OFFICIAL_AND_PARTNER:
      return {
        canInstall: authorizedCategory === 'langgenius' || authorizedCategory === 'partner',
      }
    default:
      return denyUnsupportedInstallationScope(scope)
  }
}

export default function usePluginInstallLimit(
  plugin: PluginInstallCandidate,
): PluginInstallLimitResult {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return pluginInstallLimit(plugin, systemFeatures)
}
