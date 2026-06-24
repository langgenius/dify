'use client'

import type { AgentConfigSnapshotDetailResponse, AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useHydrateAgentSoulConfigDraft } from '@/features/agent-v2/agent-composer/store'
import { agentComposerAppFeaturesAtom } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { consoleQuery } from '@/service/client'
import { AgentOrchestratePanel } from './components/orchestrate'
import { AgentPreviewChat } from './components/preview/chat'
import { AgentChatFeaturesPanel } from './components/preview/chat-features-panel'
import { AgentPreviewHeader } from './components/preview/header'
import { AgentPreviewVersionsPanel } from './components/preview/versions-panel'
import { useAgentConfigureSync } from './use-agent-configure-sync'

type AgentConfigurePageProps = {
  agentId: string
}

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
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const configureData = useAgentConfigureData(agentId, selectedVersionId)
  const isConfigureDataPending = configureData.agentQuery.isPending
    || configureData.composerQuery.isPending
    || (configureData.shouldLoadVersion && configureData.versionQuery.isPending)

  if (isConfigureDataPending) {
    return (
      <section
        aria-label={t('agentDetail.sections.configure')}
        aria-busy
        className="flex h-full min-w-0 flex-1 items-center justify-center p-1"
      >
        <Loading type="app" />
      </section>
    )
  }

  return (
    <AgentConfigurePageLoadedContent
      agentId={agentId}
      configureData={configureData}
      onSelectVersion={setSelectedVersionId}
    />
  )
}

function AgentConfigurePageLoadedContent({
  agentId,
  configureData,
  onSelectVersion,
}: AgentConfigurePageProps & {
  configureData: ReturnType<typeof useAgentConfigureData>
  onSelectVersion: (versionId: string | null) => void
}) {
  const { t } = useTranslation('agentV2')
  const [showChatFeatures, setShowChatFeatures] = useState(false)
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const {
    agentQuery,
    composerQuery,
    versionQuery,
    selectedVersionId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  } = configureData
  const agentIconType = agentQuery.data?.icon_type as AgentIconType | null | undefined
  const isViewingVersion = !!selectedVersionId

  useHydrateAgentSoulConfigDraft({
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
    draftSavedAt,
    isPublishing,
    publishDraft,
    saveDraft,
  } = useAgentConfigureSync({
    agentId,
    baseConfig: agentSoulConfig,
    currentModel,
    enabled: composerQuery.isSuccess && !selectedVersionId,
  })

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={agentQuery.isFetching}
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden p-1"
    >
      <AgentOrchestratePanel
        agentId={agentId}
        activeConfigIsPublished={agentQuery.data?.active_config_is_published}
        activeConfigSnapshot={activeConfigSnapshot}
        agentSoulConfig={agentSoulConfig}
        agentName={agentQuery.data?.name}
        currentModel={currentModel}
        textGenerationModelList={textGenerationModelList}
        draftSavedAt={draftSavedAt}
        isPublishing={isPublishing}
        readOnly={isViewingVersion}
        selectedVersionSnapshot={isViewingVersion ? activeConfigSnapshot : undefined}
        onSelectModel={setConfigureModel}
        onPublish={publishDraft}
        onOpenVersions={() => setShowPreviewVersions(true)}
        onExitVersions={() => onSelectVersion(null)}
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
            <AgentPreviewChatWithDraftConfig
              agentId={agentId}
              agentIcon={agentQuery.data?.icon}
              agentIconBackground={agentQuery.data?.icon_background}
              agentIconType={agentIconType}
              agentName={agentQuery.data?.name}
              agentSoulConfig={agentSoulConfig}
              clearChatList={clearPreviewChat}
              debugConversationId={agentQuery.data?.debug_conversation_id}
              onClearChatListChange={setClearPreviewChat}
              onSaveDraftBeforeRun={saveDraft}
            />
          </div>
        </div>

        {showPreviewVersions && (
          <AgentPreviewVersionsPanel
            agentId={agentId}
            activeVersionId={activeVersionId}
            onSelectVersion={onSelectVersion}
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

function AgentPreviewChatWithDraftConfig({
  agentSoulConfig,
  ...props
}: Omit<Parameters<typeof AgentPreviewChat>[0], 'agentSoulConfig'> & {
  agentSoulConfig?: AgentSoulConfig
}) {
  const draftAppFeatures = useAtomValue(agentComposerAppFeaturesAtom)
  const previewAgentSoulConfig = getPreviewAgentSoulConfig(agentSoulConfig, draftAppFeatures)

  return (
    <AgentPreviewChat
      {...props}
      agentSoulConfig={previewAgentSoulConfig}
    />
  )
}

function useAgentConfigureData(agentId: string, selectedVersionId: string | null) {
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
  const publishedVersionId = composerQuery.data?.active_config_snapshot?.id
  const shouldLoadPublishedVersion = !selectedVersionId && !composerQuery.data?.agent_soul
  const versionIdToLoad = selectedVersionId ?? (shouldLoadPublishedVersion ? publishedVersionId : undefined)
  const shouldLoadVersion = !!versionIdToLoad
  const versionQuery = useQuery(consoleQuery.agent.byAgentId.versions.byVersionId.get.queryOptions({
    input: versionIdToLoad
      ? {
          params: {
            agent_id: agentId,
            version_id: versionIdToLoad,
          },
        }
      : skipToken,
  }))
  const versionDetail = versionQuery.data as AgentConfigSnapshotDetailResponse | undefined
  const activeVersionId = selectedVersionId ?? (shouldLoadPublishedVersion ? publishedVersionId : null)
  const activeConfigSnapshot = selectedVersionId ? versionDetail : (composerQuery.data?.active_config_snapshot ?? versionDetail)
  const agentSoulConfig = selectedVersionId ? versionDetail?.config_snapshot : (composerQuery.data?.agent_soul ?? versionDetail?.config_snapshot)

  return {
    agentQuery,
    composerQuery,
    versionQuery,
    shouldLoadVersion,
    selectedVersionId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  }
}

function useAgentConfigureModelOptions() {
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
