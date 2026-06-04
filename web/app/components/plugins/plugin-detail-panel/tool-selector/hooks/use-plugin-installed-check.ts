import { PluginSource } from '@/app/components/plugins/types'
import {
  useCheckInstalled,
  usePluginManifestInfo,
} from '@/service/use-plugins'

type UsePluginInstalledCheckOptions = {
  providerName?: string
  providerPluginId?: string | null
  enabled?: boolean
}

export const usePluginInstalledCheck = (
  input: string | UsePluginInstalledCheckOptions = '',
) => {
  const providerName = typeof input === 'string' ? input : (input.providerName ?? '')
  const providerPluginId = typeof input === 'string' ? undefined : input.providerPluginId
  const enabled = typeof input === 'string' ? true : (input.enabled ?? true)

  const pluginID = providerPluginId === null
    ? ''
    : (providerPluginId || providerName?.split('/').splice(0, 2).join('/'))

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
