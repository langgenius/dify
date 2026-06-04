import { PluginSource } from '@/app/components/plugins/types'
import {
  useCheckInstalled,
  usePluginManifestInfo,
} from '@/service/use-plugins'

type UsePluginInstalledCheckOptions = {
  providerPluginId?: string | null
  enabled?: boolean
}

export const usePluginInstalledCheck = (
  input: UsePluginInstalledCheckOptions = {},
) => {
  const {
    providerPluginId,
    enabled = true,
  } = input
  const pluginID = providerPluginId ?? ''

  const { data: installedPluginData } = useCheckInstalled({
    pluginIds: pluginID ? [pluginID] : [],
    enabled: enabled && !!pluginID,
  })
  const installedPlugin = installedPluginData?.plugins.at(0)
  const shouldQueryMarketplace = enabled
    && !!pluginID
    && (!installedPlugin || installedPlugin.source === PluginSource.marketplace)
  const { data: manifest } = usePluginManifestInfo(shouldQueryMarketplace ? pluginID : '')

  return {
    inMarketPlace: installedPlugin?.source === PluginSource.marketplace || !!manifest,
    manifest: manifest?.data.plugin,
    pluginID,
  }
}
