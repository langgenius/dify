import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type {
  PluginBundleDependencyType,
  PluginVerification,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { zPluginInstallationScope } from '@dify/contracts/api/console/system-features/zod.gen'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

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
    case zPluginInstallationScope.enum.all:
      return { canInstall: true }
    case zPluginInstallationScope.enum.none:
      return { canInstall: false }
    case zPluginInstallationScope.enum.official_only:
      return { canInstall: authorizedCategory === 'langgenius' }
    case zPluginInstallationScope.enum.official_and_specific_partners:
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
