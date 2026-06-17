'use client'

import type { AgentConfigSnapshotSummaryResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useHydrateAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/store'
import { useAgentConfigureCurrentModel, useAgentConfigureModel } from '@/features/agent-v2/agent-detail/configure/atoms'
import { AgentOrchestratePanel } from '@/features/agent-v2/agent-detail/configure/components/orchestrate'
import { consoleQuery } from '@/service/client'
import { useWorkflowInlineAgentConfigureSync } from '../agent-soul-config'

type AgentOrchestrateDrawerPanelProps = {
  agentId: string
  inlineComposerState?: WorkflowAgentComposerResponse
  isInline: boolean
  nodeId: string
  open: boolean
}

export function AgentOrchestrateDrawerPanel(props: AgentOrchestrateDrawerPanelProps) {
  return (
    <AgentComposerProvider>
      <AgentOrchestrateDrawerPanelContent {...props} />
    </AgentComposerProvider>
  )
}

function AgentOrchestrateDrawerPanelContent({
  agentId,
  inlineComposerState,
  isInline,
  nodeId,
  open,
}: AgentOrchestrateDrawerPanelProps) {
  const rosterComposerQuery = useQuery(consoleQuery.agent.byAgentId.composer.get.queryOptions({
    input: open && !isInline
      ? {
          params: {
            agent_id: agentId,
          },
        }
      : skipToken,
  }))
  const composerState = isInline ? inlineComposerState : rosterComposerQuery.data
  const agentSoulConfig = composerState?.agent_soul
  const activeConfigSnapshot = ('active_config_snapshot' in (composerState ?? {}))
    ? composerState?.active_config_snapshot as AgentConfigSnapshotSummaryResponse | null | undefined
    : undefined
  const { currentModel, setConfigureModel, textGenerationModelList } = useAgentOrchestrateModelOptions()
  const { draftSavedAt, saveDraft } = useWorkflowInlineAgentConfigureSync({
    nodeId,
    baseConfig: agentSoulConfig,
    currentModel,
    enabled: open && isInline && !!agentSoulConfig,
  })

  useHydrateAgentSoulConfigFormState({
    agentId: isInline ? `${nodeId}:${agentId}` : agentId,
    activeVersionId: activeConfigSnapshot?.id,
    config: agentSoulConfig as AgentSoulConfig | undefined,
  })

  if (!agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <AgentOrchestratePanel
      agentId={agentId}
      activeConfigSnapshot={activeConfigSnapshot}
      agentSoulConfig={agentSoulConfig as AgentSoulConfig}
      agentName={composerState?.agent?.name}
      currentModel={currentModel}
      textGenerationModelList={textGenerationModelList}
      draftSavedAt={draftSavedAt}
      readOnly={!isInline}
      showPublishBar={false}
      className="h-full max-w-none min-w-0 flex-none rounded-none border-0"
      onSelectModel={setConfigureModel}
      onPublish={() => {
        void saveDraft()
      }}
      onOpenVersions={() => undefined}
    />
  )
}

function useAgentOrchestrateModelOptions() {
  const [, setConfigureModel] = useAgentConfigureModel()
  const {
    data: defaultTextGenerationModel,
  } = useDefaultModel(ModelTypeEnum.textGeneration)
  const defaultModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const currentModel = useAgentConfigureCurrentModel(defaultModel)
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(currentModel)

  return {
    currentModel,
    setConfigureModel,
    textGenerationModelList,
  }
}
