'use client'

import type { AgentAppDetailWithSite, AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useHydrateAgentSoulConfigDraft } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'
import { AgentOrchestratePanel } from './components/orchestrate'
import { AgentBuildDraftBar } from './components/orchestrate/build-draft-bar'
import { AgentBuildPanelBackground } from './components/preview/build-background'
import { AgentBuildChat } from './components/preview/build-chat'
import { AgentChatFeaturesPanel } from './components/preview/chat-features-panel'
import { AgentPreviewHeader } from './components/preview/header'
import { AgentPreviewChat } from './components/preview/preview-chat'
import { AgentPreviewVersionsPanel } from './components/preview/versions-panel'
import { useAgentConfigureData, useAgentConfigureModelOptions, useAgentPreviewSoulConfig } from './hooks'
import { useAgentConfigureBuildDraftActions, useAgentConfigureBuildDraftData } from './use-agent-configure-build-draft'
import { useAgentConfigureSync } from './use-agent-configure-sync'

type AgentConfigurePageProps = {
  agentId: string
}

type AgentConfigureRightPanelMode = 'build' | 'preview'
type AgentConfigureConversationIds = Record<AgentConfigureRightPanelMode, string | null>
type DebugConversationRefreshInput = {
  params: {
    agent_id: string
  }
  body: {
    debug_conversation_id: string
  }
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
  const queryClient = useQueryClient()
  const [showChatFeatures, setShowChatFeatures] = useState(false)
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<AgentConfigureRightPanelMode>('build')
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
  const [conversationIds, setConversationIds] = useState<AgentConfigureConversationIds>({
    build: agentQuery.data?.debug_conversation_id ?? null,
    preview: null,
  })
  const rightPanelChatMode: AgentConfigureRightPanelMode = rightPanelMode === 'preview' ? 'build' : rightPanelMode
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    activeVersionId,
    composerAgentSoulConfig: composerQuery.data?.agent_soul,
    isViewingVersion,
    normalAgentSoulConfig: agentSoulConfig,
  })
  const refreshDebugConversationMutation = useMutation(consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions({
    onSuccess: ({ debug_conversation_id }) => {
      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
        (agentDetail) => {
          if (!agentDetail)
            return agentDetail

          return {
            ...agentDetail,
            debug_conversation_id,
          }
        },
      )
    },
  }))
  const {
    mutate: refreshDebugConversationRequest,
    mutateAsync: refreshDebugConversationRequestAsync,
    isPending: isRefreshingDebugConversation,
  } = refreshDebugConversationMutation
  const refreshDebugConversationInput = useCallback((conversationId: string): DebugConversationRefreshInput => ({
    params: {
      agent_id: agentId,
    },
    body: {
      debug_conversation_id: conversationId,
    },
  }), [agentId])
  const refreshDebugConversation = useCallback((conversationId: string) => {
    const input = refreshDebugConversationInput(conversationId)

    refreshDebugConversationRequest(
      input as unknown as Parameters<typeof refreshDebugConversationRequest>[0],
    )
  }, [refreshDebugConversationInput, refreshDebugConversationRequest])
  const refreshDebugConversationAsync = useCallback((conversationId: string) => {
    const input = refreshDebugConversationInput(conversationId)

    return refreshDebugConversationRequestAsync(
      input as unknown as Parameters<typeof refreshDebugConversationRequestAsync>[0],
    )
  }, [refreshDebugConversationInput, refreshDebugConversationRequestAsync])
  const updateConversationId = (mode: AgentConfigureRightPanelMode, conversationId: string) => {
    setConversationIds(current => ({
      ...current,
      [mode]: conversationId,
    }))
  }
  const restartCurrentChat = () => {
    if (rightPanelChatMode === 'build')
      refreshDebugConversation(conversationIds.build ?? '')

    setConversationIds(current => ({
      ...current,
      [rightPanelChatMode]: null,
    }))
    setClearPreviewChat(true)
  }
  const resetBuildChatSession = useCallback(async () => {
    await refreshDebugConversationAsync(conversationIds.build ?? '')
    setConversationIds(current => ({
      ...current,
      build: null,
    }))
    setClearPreviewChat(true)
  }, [conversationIds.build, refreshDebugConversationAsync])

  useHydrateAgentSoulConfigDraft({
    agentId,
    activeVersionId: buildDraft.activeVersionId,
    config: buildDraft.agentSoulConfig,
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
    enabled: composerQuery.isSuccess && !selectedVersionId && !buildDraft.isActive,
  })
  const buildDraftActions = useAgentConfigureBuildDraftActions({
    agentId,
    isActive: buildDraft.isActive,
    refetchBuildDraft: buildDraft.refetch,
    refetchComposer: composerQuery.refetch,
    resetBuildChatSession,
    saveDraft,
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const selectVersion = useCallback((versionId: string | null) => {
    buildDraft.setSoulSourceOverride(versionId ? 'view-version' : null)
    onSelectVersion(versionId)
  }, [buildDraft, onSelectVersion])

  if (buildDraft.isPending) {
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
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={agentQuery.isFetching}
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden bg-background-body p-1"
    >
      <AgentOrchestratePanel
        agentId={agentId}
        activeConfigIsPublished={agentQuery.data?.active_config_is_published}
        activeConfigSnapshot={activeConfigSnapshot}
        agentSoulConfig={buildDraft.agentSoulConfig}
        agentName={agentQuery.data?.name}
        currentModel={currentModel}
        textGenerationModelList={textGenerationModelList}
        draftSavedAt={draftSavedAt}
        isPublishing={isPublishing}
        readOnly={isViewingVersion || buildDraft.isActive}
        selectedVersionSnapshot={isViewingVersion ? activeConfigSnapshot : undefined}
        isBuildDraftActive={buildDraft.isActive}
        showPublishBar={!buildDraft.isActive}
        bottomBar={buildDraft.isActive
          ? (
              <AgentBuildDraftBar
                changesCount={buildDraft.changesCount}
                isApplying={buildDraftActions.isApplyingBuildDraft}
                isDiscarding={buildDraftActions.isDiscardingBuildDraft}
                onApply={() => {
                  void buildDraftActions.applyBuildDraft()
                }}
                onDiscard={() => {
                  void buildDraftActions.discardBuildDraft()
                }}
              />
            )
          : undefined}
        onSelectModel={setConfigureModel}
        onPublish={publishDraft}
        onOpenVersions={() => setShowPreviewVersions(true)}
        onExitVersions={() => selectVersion(null)}
      />

      {/* Preview area */}
      <div className="flex min-w-105 flex-1 gap-1 overflow-hidden">
        <div className="relative isolate flex min-w-105 flex-1 flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
          <AgentBuildPanelBackground visible={rightPanelChatMode === 'build'} />
          <AgentPreviewHeader
            mode={rightPanelChatMode}
            previewEnabled={false}
            isChatFeaturesOpen={showChatFeatures}
            onModeChange={setRightPanelMode}
            onToggleChatFeatures={() => setShowChatFeatures(open => !open)}
            onOpenVersions={() => setShowPreviewVersions(true)}
            onRefresh={restartCurrentChat}
            refreshDisabled={isRefreshingDebugConversation}
          />

          <div className="relative z-1 min-h-0 flex-1">
            <AgentRightPanelChatWithDraftConfig
              agentId={agentId}
              agentIcon={agentQuery.data?.icon}
              agentIconBackground={agentQuery.data?.icon_background}
              agentIconType={agentIconType}
              agentName={agentQuery.data?.name}
              agentSoulConfig={buildDraft.agentSoulConfig}
              clearChatList={clearPreviewChat}
              conversationIds={conversationIds}
              draftType={rightPanelChatMode === 'build' ? 'debug_build' : undefined}
              mode={rightPanelChatMode}
              onClearChatListChange={setClearPreviewChat}
              onConversationComplete={buildDraftActions.refreshBuildDraftAfterBuildChat}
              onConversationIdChange={updateConversationId}
              onSaveDraftBeforeRun={rightPanelChatMode === 'build' ? buildDraftActions.prepareBuildDraftBeforeRun : saveDraft}
            />
          </div>
        </div>

        {showPreviewVersions && (
          <AgentPreviewVersionsPanel
            agentId={agentId}
            activeVersionId={activeVersionId}
            onSelectVersion={selectVersion}
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

function AgentRightPanelChatWithDraftConfig({
  agentSoulConfig,
  conversationIds,
  mode,
  onConversationComplete,
  onConversationIdChange,
  ...props
}: Omit<Parameters<typeof AgentPreviewChat>[0], 'agentSoulConfig' | 'conversationId' | 'onConversationComplete' | 'onConversationIdChange'> & {
  agentSoulConfig?: AgentSoulConfig
  conversationIds: AgentConfigureConversationIds
  mode: AgentConfigureRightPanelMode
  onConversationComplete?: (mode: AgentConfigureRightPanelMode) => void
  onConversationIdChange: (mode: AgentConfigureRightPanelMode, conversationId: string) => void
}) {
  const previewAgentSoulConfig = useAgentPreviewSoulConfig(agentSoulConfig)
  const conversationId = conversationIds[mode]
  const handleConversationIdChange = (newConversationId: string) => {
    onConversationIdChange(mode, newConversationId)
  }
  const handleConversationComplete = () => {
    onConversationComplete?.(mode)
  }

  return mode === 'build'
    ? (
        <AgentBuildChat
          {...props}
          conversationId={conversationId}
          agentSoulConfig={previewAgentSoulConfig}
          onConversationComplete={handleConversationComplete}
          onConversationIdChange={handleConversationIdChange}
        />
      )
    : (
        <AgentPreviewChat
          {...props}
          conversationId={conversationId}
          agentSoulConfig={previewAgentSoulConfig}
          onConversationComplete={handleConversationComplete}
          onConversationIdChange={handleConversationIdChange}
        />
      )
}
