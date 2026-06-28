'use client'

import type { AgentConfigSnapshotDetailResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { agentComposerAppFeaturesAtom } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { consoleQuery } from '@/service/client'
import { useAgentConfigureBuildDraftData } from './use-agent-configure-build-draft'

export function useAgentConfigureData(agentId: string, selectedVersionId: string | null) {
  const agentQuery = useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const composerQuery = useQuery(consoleQuery.agent.byAgentId.composer.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const shouldLoadVersion = !!selectedVersionId
  const versionQuery = useQuery(consoleQuery.agent.byAgentId.versions.byVersionId.get.queryOptions({
    input: selectedVersionId
      ? {
          params: {
            agent_id: agentId,
            version_id: selectedVersionId,
          },
        }
      : skipToken,
  }))
  const versionDetail = versionQuery.data as AgentConfigSnapshotDetailResponse | undefined
  const activeVersionSnapshot = selectedVersionId ? versionDetail : composerQuery.data?.active_config_snapshot
  const normalAgentSoulConfig = selectedVersionId ? versionDetail?.config_snapshot : composerQuery.data?.agent_soul
  const isViewingVersion = !!selectedVersionId
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    composerAgentSoulConfig: composerQuery.data?.agent_soul,
    isViewingVersion,
  })
  const activeVersionId = buildDraft.isActive
    ? `build-draft:${buildDraft.dataUpdatedAt}`
    : selectedVersionId
  const agentSoulConfig = buildDraft.isActive
    ? buildDraft.agentSoulConfig
    : normalAgentSoulConfig
  const isPending = agentQuery.isPending
    || composerQuery.isPending
    || (shouldLoadVersion && versionQuery.isPending)
    || buildDraft.isPending

  return {
    agentQuery,
    composerQuery,
    versionQuery,
    shouldLoadVersion,
    selectedVersionId,
    activeVersionId,
    activeVersionSnapshot,
    agentSoulConfig,
    buildDraft,
    isPending,
  }
}

export function useAgentConfigureModelOptions() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  const {
    data: defaultTextGenerationModel,
  } = useDefaultModel(ModelTypeEnum.textGeneration)
  const defaultModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const currentModel = model ?? defaultModel
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(currentModel)

  return {
    currentModel,
    setConfigureModel: setModel,
    textGenerationModelList,
  }
}

export function useAgentPreviewSoulConfig(
  agentSoulConfig: AgentSoulConfig | undefined,
) {
  const draftAppFeatures = useAtomValue(agentComposerAppFeaturesAtom)

  if (!agentSoulConfig || !draftAppFeatures)
    return agentSoulConfig

  return {
    ...agentSoulConfig,
    app_features: draftAppFeatures,
  }
}
