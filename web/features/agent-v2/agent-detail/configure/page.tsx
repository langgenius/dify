'use client'

import type { AgentConfigSnapshotDetailResponse } from '@dify/contracts/api/console/agents/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { consoleQuery } from '@/service/client'
import { useAgentConfigureCurrentModel, useAgentConfigureModel, useHydrateAgentConfigureDraft } from './atoms'
import { AgentOrchestratePanel } from './components/agent-orchestrate-panel'
import { AgentPreviewChat } from './components/agent-preview-chat'
import { AgentPreviewHeader } from './components/agent-preview-header'
import { AgentPreviewVersionsPanel } from './components/agent-preview-versions-panel'

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [, setConfigureModel] = useAgentConfigureModel()
  const agentQuery = useQuery(consoleQuery.agents.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const activeVersionId = agentQuery.data?.active_config_snapshot_id
  const versionQuery = useQuery(consoleQuery.agents.byAgentId.versions.byVersionId.get.queryOptions({
    input: activeVersionId
      ? {
          params: {
            agent_id: agentId,
            version_id: activeVersionId,
          },
        }
      : skipToken,
  }))
  const agentSoulConfig = (versionQuery.data as AgentConfigSnapshotDetailResponse | undefined)?.config_snapshot
  useHydrateAgentConfigureDraft({
    agentId,
    activeVersionId,
    config: agentSoulConfig,
  })
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

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={agentQuery.isPending}
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden p-1"
    >
      <AgentOrchestratePanel
        agentId={agentId}
        agentSoulConfig={agentSoulConfig}
        currentModel={currentModel}
        textGenerationModelList={textGenerationModelList}
        onSelectModel={setConfigureModel}
        onOpenVersions={() => setShowPreviewVersions(true)}
      />

      {/* Preview area */}
      <div className="flex min-w-105 flex-1 gap-1 overflow-hidden">
        <div className="flex min-w-105 flex-1 flex-col overflow-hidden rounded-lg bg-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
          <AgentPreviewHeader
            isVersionsOpen={showPreviewVersions}
            onToggleVersions={() => setShowPreviewVersions(open => !open)}
            onRestart={() => setClearPreviewChat(true)}
          />

          <div className="min-h-0 flex-1">
            <AgentPreviewChat
              appId={agentQuery.data?.app_id}
              activeVersionId={activeVersionId}
              agentSoulConfig={agentSoulConfig}
              isConfigPending={versionQuery.isPending}
              clearChatList={clearPreviewChat}
              onClearChatListChange={setClearPreviewChat}
            />
          </div>
        </div>

        {showPreviewVersions && (
          <AgentPreviewVersionsPanel
            agentId={agentId}
            activeVersionId={agentQuery.data?.active_config_snapshot_id}
            onClose={() => setShowPreviewVersions(false)}
          />
        )}
      </div>
    </section>
  )
}
