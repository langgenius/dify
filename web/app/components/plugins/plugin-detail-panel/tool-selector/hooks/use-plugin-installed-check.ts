import { useQuery } from '@tanstack/react-query'
import { PluginSource } from '@/app/components/plugins/types'
import { installedPluginsByIdsQueryOptions } from '@/service/plugin-list-queries'
import { usePluginManifestInfo } from '@/service/use-plugins'

type UsePluginInstalledCheckOptions = {
  providerPluginId?: string | null
  enabled?: boolean
}

export const usePluginInstalledCheck = (input: UsePluginInstalledCheckOptions = {}) => {
  const { providerPluginId, enabled = true } = input
  const pluginID = providerPluginId ?? ''

  const { data: installedPluginData } = useQuery(
    installedPluginsByIdsQueryOptions({
      pluginIds: pluginID ? [pluginID] : [],
      enabled: enabled && !!pluginID,
    }),
  )
  const installedPlugin = installedPluginData?.plugins.at(0)
  const shouldQueryMarketplace =
    enabled &&
    !!pluginID &&
    (!installedPlugin || installedPlugin.source === PluginSource.marketplace)
  const { data: manifest } = usePluginManifestInfo(shouldQueryMarketplace ? pluginID : '')

  return {
    inMarketPlace: installedPlugin?.source === PluginSource.marketplace || !!manifest,
    manifest: manifest?.data.plugin,
    pluginID,
  }
}
