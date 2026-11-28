import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useInvalidateDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { consoleQuery } from '@/service/console'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
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
  const invalidateDefaultModel = useInvalidateDefaultModel()
  const queryClient = useQueryClient()

  const refreshPluginList = useCallback(
    (
      manifest?: PluginManifestInMarket | Plugin | PluginDeclaration | PluginCategoryPayload | null,
      refreshAllType?: boolean,
    ) => {
      // installed list
      if (refreshAllType || !manifest) invalidateInstalledPluginList()
      else invalidateInstalledPluginList(manifest.category)
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
        // TODO: refresh the suggested marketplace tools (useMarketplacePlugins in marketplace/query.ts).
      }

      if ((manifest && PluginCategoryEnum.trigger.includes(manifest.category)) || refreshAllType) {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }),
        })
      }

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
        SYSTEM_MODEL_TYPES.forEach((type) => {
          queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
              input: { params: { model_type: type } },
            }),
          })
          invalidateDefaultModel(type)
        })
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
    [invalidateDefaultModel, invalidateInstalledPluginList, queryClient],
  )

  return { refreshPluginList }
}

export default useRefreshPluginList
