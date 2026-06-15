'use client'

import type { AgentConfigSnapshotDetailResponse, AgentPublishedReferenceResponse, AgentSoulConfig } from '@dify/contracts/api/console/agents/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/client'
import {
  useAgentConfigureAppFeatures,
  useAgentConfigureCurrentModel,
  useAgentConfigureModel,
  useHydrateAgentConfigureDraft,
} from './atoms'
import { AgentOrchestratePanel } from './components/orchestrate'
import { AgentPreviewChat } from './components/preview/chat'
import { AgentChatFeaturesPanel } from './components/preview/chat-features-panel'
import { AgentPreviewHeader } from './components/preview/header'
import { AgentPreviewVersionsPanel } from './components/preview/versions-panel'
import { useAgentConfigureSync } from './use-agent-configure-sync'

type AgentConfigurePageProps = {
  agentId: string
}

const mockPublishedReferences: AgentPublishedReferenceResponse[] = [
  {
    app_id: 'mock-python-fixer-app',
    app_mode: 'workflow',
    app_name: 'Python bug fixer',
    workflow_id: 'mock-python-fixer-workflow',
    workflow_version: '1',
  },
  {
    app_id: 'mock-translation-app',
    app_mode: 'workflow',
    app_name: 'Translation Workflow',
    workflow_id: 'mock-translation-workflow',
    workflow_version: '1',
  },
  {
    app_id: 'mock-email-reply-app',
    app_mode: 'workflow',
    app_name: 'Automated Email Reply',
    workflow_id: 'mock-email-reply-workflow',
    workflow_version: '1',
  },
]

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  return (
    <AgentComposerProvider>
      <AgentConfigurePageContent agentId={agentId} />
    </AgentComposerProvider>
  )
}

function AgentConfigurePageContent({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [showChatFeatures, setShowChatFeatures] = useState(false)
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const {
    agentQuery,
    composerQuery,
    versionQuery,
    appId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  } = useAgentConfigureData(agentId)
  const draftAppFeatures = useAgentConfigureAppFeatures()

  useHydrateAgentConfigureDraft({
    agentId,
    activeVersionId,
    config: agentSoulConfig,
  })
  const {
    currentModel,
    setConfigureModel,
    textGenerationModelList,
  } = useAgentConfigureModelOptions()
  const {
    isPublishing,
    publishDraft,
  } = useAgentConfigureSync({
    agentId,
    appId,
    baseConfig: agentSoulConfig,
    currentModel,
    enabled: composerQuery.isSuccess,
  })
  const publishedReferences = agentQuery.data?.published_references?.length
    ? agentQuery.data.published_references
    : mockPublishedReferences
  const publishedReferenceCount = agentQuery.data?.published_reference_count || publishedReferences.length
  const previewAgentSoulConfig = getPreviewAgentSoulConfig(agentSoulConfig, draftAppFeatures)

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={agentQuery.isPending}
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden p-1"
    >
      <AgentOrchestratePanel
        agentId={agentId}
        activeConfigSnapshot={activeConfigSnapshot}
        agentSoulConfig={agentSoulConfig}
        agentName={agentQuery.data?.name}
        currentModel={currentModel}
        textGenerationModelList={textGenerationModelList}
        isPublishing={isPublishing}
        publishedReferenceCount={publishedReferenceCount}
        publishedReferences={publishedReferences}
        onSelectModel={setConfigureModel}
        onPublish={publishDraft}
        onOpenVersions={() => setShowPreviewVersions(true)}
      />

      {/* Preview area */}
      <div className="flex min-w-105 flex-1 gap-1 overflow-hidden">
        <div className="flex min-w-105 flex-1 flex-col overflow-hidden rounded-lg bg-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
          <AgentPreviewHeader
            isChatFeaturesOpen={showChatFeatures}
            onToggleChatFeatures={() => setShowChatFeatures(open => !open)}
            onRestart={() => setClearPreviewChat(true)}
          />

          <div className="min-h-0 flex-1">
            <AgentPreviewChat
              appId={agentQuery.data?.app_id}
              agentIcon={agentQuery.data?.icon}
              agentIconBackground={agentQuery.data?.icon_background}
              agentIconType={agentQuery.data?.icon_type}
              agentName={agentQuery.data?.name}
              agentSoulConfig={previewAgentSoulConfig}
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
        <AgentChatFeaturesPanel
          show={showChatFeatures}
          appFeatures={agentSoulConfig?.app_features}
          disabled={versionQuery.isPending}
          onClose={() => setShowChatFeatures(false)}
        />
      </div>
    </section>
  )
}

function useAgentConfigureData(agentId: string) {
  const agentQuery = useQuery(consoleQuery.agents.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const appId = agentQuery.data?.app_id
  const composerQuery = useQuery(consoleQuery.apps.byAppId.agentComposer.get.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
  }))
  const activeVersionId = composerQuery.data?.active_config_snapshot.id ?? agentQuery.data?.active_config_snapshot_id
  const shouldLoadPublishedVersion = !composerQuery.data?.agent_soul
  const versionQuery = useQuery(consoleQuery.agents.byAgentId.versions.byVersionId.get.queryOptions({
    input: activeVersionId && shouldLoadPublishedVersion
      ? {
          params: {
            agent_id: agentId,
            version_id: activeVersionId,
          },
        }
      : skipToken,
  }))
  const versionDetail = versionQuery.data as AgentConfigSnapshotDetailResponse | undefined
  const activeConfigSnapshot = composerQuery.data?.active_config_snapshot ?? versionDetail ?? agentQuery.data?.active_config_snapshot
  const agentSoulConfig = composerQuery.data?.agent_soul ?? versionDetail?.config_snapshot

  return {
    agentQuery,
    composerQuery,
    versionQuery,
    appId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  }
}

function useAgentConfigureModelOptions() {
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

function getPreviewAgentSoulConfig(
  agentSoulConfig: AgentSoulConfig | undefined,
  draftAppFeatures: AgentSoulConfig['app_features'] | undefined,
) {
  if (!agentSoulConfig || !draftAppFeatures)
    return agentSoulConfig

  return {
    ...agentSoulConfig,
    app_features: draftAppFeatures,
  }
}
