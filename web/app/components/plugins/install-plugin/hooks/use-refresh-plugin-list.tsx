import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useProviderContext } from '@/context/provider-context'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useInvalidateAllBuiltInTools, useInvalidateAllToolProviders } from '@/service/use-tools'
import { useInvalidateStrategyProviders } from '@/service/use-strategy'
import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { PluginType } from '../../types'

const useRefreshPluginList = () => {
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const { mutate: refetchLLMModelList } = useModelList(ModelTypeEnum.textGeneration)
  const { mutate: refetchEmbeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { mutate: refetchRerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { refreshModelProviders } = useProviderContext()

  const invalidateAllToolProviders = useInvalidateAllToolProviders()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()

  const invalidateStrategyProviders = useInvalidateStrategyProviders()
  return {
    refreshPluginList: (manifest?: PluginManifestInMarket | Plugin | PluginDeclaration | null, refreshAllType?: boolean) => {
      // installed list
      invalidateInstalledPluginList()

      // tool page, tool select
      if ((manifest && PluginType.tool.includes(manifest.category)) || refreshAllType) {
        invalidateAllToolProviders()
        invalidateAllBuiltInTools()
        // TODO: update suggested tools. It's a function in hook useMarketplacePlugins,handleUpdatePlugins
      }

      // model select
      if ((manifest && PluginType.model.includes(manifest.category)) || refreshAllType) {
        refreshModelProviders()
        refetchLLMModelList()
        refetchEmbeddingModelList()
        refetchRerankModelList()
      }

      // agent select
      if ((manifest && PluginType.agent.includes(manifest.category)) || refreshAllType)
        invalidateStrategyProviders()
    },
  }
}

export default useRefreshPluginList
