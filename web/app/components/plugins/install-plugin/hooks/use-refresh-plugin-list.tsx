import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useInvalidateDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { consoleQuery } from '@/service/console'
import {
  useInvalidateCheckInstalled,
  useInvalidateInstalledPluginList,
} from '@/service/use-plugins'
import { useInvalidateAllTriggerPlugins } from '@/service/use-triggers'
import { PluginCategoryEnum } from '../../types'

type PluginCategoryPayload = {
  category: PluginCategoryEnum
}

const SYSTEM_MODEL_TYPES = [
  ModelTypeEnum.textGeneration,
  ModelTypeEnum.textEmbedding,
  ModelTypeEnum.rerank,
  ModelTypeEnum.speech2text,
  ModelTypeEnum.tts,
]

const useRefreshPluginList = () => {
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const invalidateCheckInstalled = useInvalidateCheckInstalled()
  const { refetch: refetchLLMModelList } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }),
  )
  const { refetch: refetchEmbeddingModelList } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textEmbedding } },
    }),
  )
  const { refetch: refetchRerankModelList } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.rerank } },
    }),
  )
  const { refetch: refetchSpeech2textModelList } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.speech2text } },
    }),
  )
  const { refetch: refetchTTSModelList } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.tts } },
    }),
  )
  const invalidateDefaultModel = useInvalidateDefaultModel()
  const queryClient = useQueryClient()

  const invalidateAllTriggerPlugins = useInvalidateAllTriggerPlugins()
  return {
    refreshPluginList: (
      manifest?: PluginManifestInMarket | Plugin | PluginDeclaration | PluginCategoryPayload | null,
      refreshAllType?: boolean,
    ) => {
      // installed list
      if (refreshAllType || !manifest) invalidateInstalledPluginList()
      else invalidateInstalledPluginList(manifest.category)
      invalidateCheckInstalled()
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.list.installations.ids.post.key(),
      })
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.list.latestVersions.post.key(),
      })

      // tool page, tool select
      if ((manifest && PluginCategoryEnum.tool.includes(manifest.category)) || refreshAllType) {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.toolProviders.get.key(),
        })
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.builtin.get.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rag.pipelines.recommendedPlugins.get.queryKey({
            input: { query: { type: 'tool' } },
          }),
        })
        // TODO: update suggested tools. It's a function in hook useMarketplacePlugins,handleUpdatePlugins
      }

      if ((manifest && PluginCategoryEnum.trigger.includes(manifest.category)) || refreshAllType)
        invalidateAllTriggerPlugins()

      if (
        (manifest && PluginCategoryEnum.datasource.includes(manifest.category)) ||
        refreshAllType
      ) {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rag.pipelines.datasourcePlugins.get.key(),
        })
        queryClient.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.queryKey(),
        })
      }

      // model select
      if ((manifest && PluginCategoryEnum.model.includes(manifest.category)) || refreshAllType) {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
        })
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.modelProviders.get.key(),
        })
        refetchLLMModelList()
        refetchEmbeddingModelList()
        refetchRerankModelList()
        refetchSpeech2textModelList()
        refetchTTSModelList()
        SYSTEM_MODEL_TYPES.forEach((type) => invalidateDefaultModel(type))
      }

      // agent select
      if ((manifest && PluginCategoryEnum.agent.includes(manifest.category)) || refreshAllType) {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.agentProviders.get.key(),
        })
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.agentProvider.byProviderName.get.key(),
        })
      }
    },
  }
}

export default useRefreshPluginList
