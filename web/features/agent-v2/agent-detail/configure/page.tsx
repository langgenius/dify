'use client'

import type { AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useHydrateAgentSoulConfigDraft } from '@/features/agent-v2/agent-composer/store'
import { AgentOrchestratePanel } from './components/orchestrate'
import { AgentPreviewChat } from './components/preview/chat'
import { AgentChatFeaturesPanel } from './components/preview/chat-features-panel'
import { AgentPreviewHeader } from './components/preview/header'
import { AgentPreviewVersionsPanel } from './components/preview/versions-panel'
import { useAgentConfigureData, useAgentConfigureModelOptions, useAgentPreviewSoulConfig } from './hooks'
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
            agentId={agentId}
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
  const previewAgentSoulConfig = useAgentPreviewSoulConfig(agentSoulConfig)

  return (
    <AgentPreviewChat
      {...props}
      agentSoulConfig={previewAgentSoulConfig}
    />
  )
}
