import {
  usePluginManifestInfo,
} from '@/service/use-plugins'

export const usePluginInstalledCheck = (providerName = '') => {
  const pluginID = providerName?.split('/').splice(0, 2).join('/')

  const { data: manifest } = usePluginManifestInfo(pluginID)

  return {
    inMarketPlace: !!manifest,
    manifest: manifest?.data.plugin,
  }
}
