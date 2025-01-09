import { useUpdateModelProviders } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useProviderContext } from '@/context/provider-context'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useInvalidateAllBuiltInTools, useInvalidateAllToolProviders } from '@/service/use-tools'
import { useInvalidateStrategyProviders } from '@/service/use-strategy'
import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { PluginType } from '../../types'

const useRefreshPluginList = () => {
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const updateModelProviders = useUpdateModelProviders()
  const { refreshModelProviders } = useProviderContext()

  const invalidateAllToolProviders = useInvalidateAllToolProviders()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()

  const invalidateStrategyProviders = useInvalidateStrategyProviders()
  return {
    refreshPluginList: (manifest?: PluginManifestInMarket | Plugin | PluginDeclaration | null, refreshAllType?: boolean) => {
      // installed list
      invalidateInstalledPluginList()

      if (!manifest) return

      // tool page, tool select
      if (PluginType.tool.includes(manifest.category) || refreshAllType) {
        invalidateAllToolProviders()
        invalidateAllBuiltInTools()
        // TODO: update suggested tools. It's a function in hook useMarketplacePlugins,handleUpdatePlugins
      }

      // model select
      if (PluginType.model.includes(manifest.category) || refreshAllType) {
        updateModelProviders()
        refreshModelProviders()
      }

      // agent select
      if (PluginType.agent.includes(manifest.category) || refreshAllType)
        invalidateStrategyProviders()
    },
  }
}

export default useRefreshPluginList
