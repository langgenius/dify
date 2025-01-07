import { useUpdateModelProviders } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useProviderContext } from '@/context/provider-context'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useInvalidateAllBuiltInTools, useInvalidateAllToolProviders } from '@/service/use-tools'
import { useInvalidateStrategyProviders } from '@/service/use-strategy'
import type { Plugin, PluginManifestInMarket } from '../../types'
import { PluginType } from '../../types'

const useRefreshPluginList = () => {
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const updateModelProviders = useUpdateModelProviders()
  const { refreshModelProviders } = useProviderContext()

  const invalidateAllToolProviders = useInvalidateAllToolProviders()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()

  const invalidateStrategyProviders = useInvalidateStrategyProviders()
  return {
    refreshPluginList: (manifest: PluginManifestInMarket | Plugin) => {
      // installed list
      invalidateInstalledPluginList()

      // tool page, tool select
      if (PluginType.tool.includes(manifest.category)) {
        invalidateAllToolProviders()
        invalidateAllBuiltInTools()
        // TODO: update suggested tools. It's a function in hook useMarketplacePlugins,handleUpdatePlugins
      }

      // model select
      if (PluginType.model.includes(manifest.category)) {
        updateModelProviders()
        refreshModelProviders()
      }

      // agent select
      if (PluginType.agent.includes(manifest.category))
        invalidateStrategyProviders()
    },
  }
}

export default useRefreshPluginList
