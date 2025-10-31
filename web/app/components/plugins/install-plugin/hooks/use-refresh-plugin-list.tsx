import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useProviderContext } from '@/context/provider-context'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useInvalidateAllBuiltInTools, useInvalidateAllToolProviders, useInvalidateRAGRecommendedPlugins } from '@/service/use-tools'
import { useInvalidateStrategyProviders } from '@/service/use-strategy'
import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { PluginCategoryEnum } from '../../types'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import { useInvalidDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidateAllTriggerPlugins } from '@/service/use-triggers'

const useRefreshPluginList = () => {
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const { mutate: refetchLLMModelList } = useModelList(ModelTypeEnum.textGeneration)
  const { mutate: refetchEmbeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { mutate: refetchRerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { refreshModelProviders } = useProviderContext()

  const invalidateAllToolProviders = useInvalidateAllToolProviders()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()
  const invalidateAllDataSources = useInvalidDataSourceList()

  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()

  const invalidateStrategyProviders = useInvalidateStrategyProviders()

  const invalidateAllTriggerPlugins = useInvalidateAllTriggerPlugins()

  const invalidateRAGRecommendedPlugins = useInvalidateRAGRecommendedPlugins()
  return {
    refreshPluginList: (manifest?: PluginManifestInMarket | Plugin | PluginDeclaration | null, refreshAllType?: boolean) => {
      // installed list
      invalidateInstalledPluginList()

      // tool page, tool select
      if ((manifest && PluginCategoryEnum.tool.includes(manifest.category)) || refreshAllType) {
        invalidateAllToolProviders()
        invalidateAllBuiltInTools()
        invalidateRAGRecommendedPlugins()
        // TODO: update suggested tools. It's a function in hook useMarketplacePlugins,handleUpdatePlugins
      }

      if ((manifest && PluginCategoryEnum.trigger.includes(manifest.category)) || refreshAllType)
        invalidateAllTriggerPlugins()

      if ((manifest && PluginCategoryEnum.datasource.includes(manifest.category)) || refreshAllType) {
        invalidateAllDataSources()
        invalidateDataSourceListAuth()
      }

      // model select
      if ((manifest && PluginCategoryEnum.model.includes(manifest.category)) || refreshAllType) {
        refreshModelProviders()
        refetchLLMModelList()
        refetchEmbeddingModelList()
        refetchRerankModelList()
      }

      // agent select
      if ((manifest && PluginCategoryEnum.agent.includes(manifest.category)) || refreshAllType)
        invalidateStrategyProviders()
    },
  }
}

export default useRefreshPluginList
