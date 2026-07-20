'use client'

import type {
  AgentConfigSnapshotDetailResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { agentComposerAppFeaturesAtom } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { consoleQuery } from '@/service/client'

export function useAgentConfigureData(agentId: string, selectedVersionId: string | null) {
  const agentQuery = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
  )
  const composerQuery = useQuery(
    consoleQuery.agent.byAgentId.composer.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
  )
  const publishedVersionId = composerQuery.data?.active_config_snapshot?.id
  const shouldLoadPublishedVersion = !selectedVersionId && !composerQuery.data?.agent_soul
  const versionIdToLoad =
    selectedVersionId ?? (shouldLoadPublishedVersion ? publishedVersionId : undefined)
  const shouldLoadVersion = !!versionIdToLoad
  const versionQuery = useQuery(
    consoleQuery.agent.byAgentId.versions.byVersionId.get.queryOptions({
      input: versionIdToLoad
        ? {
            params: {
              agent_id: agentId,
              version_id: versionIdToLoad,
            },
          }
        : skipToken,
    }),
  )
  const versionDetail = versionQuery.data as AgentConfigSnapshotDetailResponse | undefined
  const activeVersionId =
    selectedVersionId ?? (shouldLoadPublishedVersion ? publishedVersionId : null)
  const activeConfigSnapshot = selectedVersionId
    ? versionDetail
    : (composerQuery.data?.active_config_snapshot ?? versionDetail)
  const agentSoulConfig = selectedVersionId
    ? versionDetail?.config_snapshot
    : (composerQuery.data?.agent_soul ?? versionDetail?.config_snapshot)
  const isPending =
    agentQuery.isPending || composerQuery.isPending || (shouldLoadVersion && versionQuery.isPending)

  return {
    agentQuery,
    composerQuery,
    versionQuery,
    shouldLoadVersion,
    selectedVersionId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
    isPending,
  }
}

export function useAgentConfigureModelOptions() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  const { data: defaultTextGenerationModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const defaultModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const currentModel = model ?? defaultModel
  const { textGenerationModelList } =
    useTextGenerationCurrentProviderAndModelAndModelList(currentModel)

  return {
    currentModel,
    setConfigureModel: setModel,
    textGenerationModelList,
  }
}

export function useAgentPreviewSoulConfig(agentSoulConfig: AgentSoulConfig | undefined) {
  const draftAppFeatures = useAtomValue(agentComposerAppFeaturesAtom)

  if (!agentSoulConfig || !draftAppFeatures) return agentSoulConfig

  return {
    ...agentSoulConfig,
    app_features: draftAppFeatures,
  }
}
