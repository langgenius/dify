'use client'

import type { AgentAppDetailWithSite, AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { Dispatch, SetStateAction } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/client'
import { AgentOrchestratePanel } from './components/orchestrate'
import { AgentBuildDraftBar } from './components/orchestrate/build-draft-bar'
import { AgentBuildPanelBackground } from './components/preview/build-background'
import { AgentBuildChat } from './components/preview/build-chat'
import { AgentChatFeaturesPanel } from './components/preview/chat-features-panel'
import { AgentPreviewHeader } from './components/preview/header'
import { AgentPreviewChat } from './components/preview/preview-chat'
import { useAgentWorkingDirectoryPanel } from './components/preview/use-working-directory-panel'
import { AgentPreviewVersionsPanel } from './components/preview/versions-panel'
import { AgentConfigurePreviewSurface, AgentConfigureWorkspace } from './components/workspace'
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
    <AgentConfigurePageContent agentId={agentId} />
  )
}

function AgentConfigurePageContent({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [composerRebaseRevision, setComposerRebaseRevision] = useState(0)
  const configureData = useAgentConfigureData(agentId, selectedVersionId)
  const isConfigureDataPending = configureData.agentQuery.isPending
    || configureData.composerQuery.isPending
    || (configureData.shouldLoadVersion && configureData.versionQuery.isPending)

  if (isConfigureDataPending) {
    return (
      <AgentConfigurePageLoading label={t('agentDetail.sections.configure')} />
    )
  }

  return (
    <AgentConfigurePageLoadedContent
      agentId={agentId}
      composerRebaseRevision={composerRebaseRevision}
      configureData={configureData}
      onComposerRebase={() => setComposerRebaseRevision(revision => revision + 1)}
      onSelectVersion={setSelectedVersionId}
    />
  )
}

function AgentConfigurePageLoadedContent({
  agentId,
  composerRebaseRevision,
  configureData,
  onComposerRebase,
  onSelectVersion,
}: AgentConfigurePageProps & {
  composerRebaseRevision: number
  configureData: ReturnType<typeof useAgentConfigureData>
  onComposerRebase: () => void
  onSelectVersion: (versionId: string | null) => void
}) {
  const { t } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const [showChatFeatures, setShowChatFeatures] = useState(false)
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<AgentConfigureRightPanelMode>('build')
  const [hideBuildDraftBarUntilRefresh, setHideBuildDraftBarUntilRefresh] = useState(false)
  const {
    agentQuery,
    composerQuery,
    selectedVersionId,
    activeVersionId,
    agentSoulConfig,
  } = configureData
  const agentIconType = agentQuery.data?.icon_type as AgentIconType | null | undefined
  const isViewingVersion = !!selectedVersionId
  const [conversationIds, setConversationIds] = useState<AgentConfigureConversationIds>({
    build: agentQuery.data?.debug_conversation_id ?? null,
    preview: null,
  })
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
  const resetBuildChatSession = useCallback(async () => {
    await refreshDebugConversationAsync(conversationIds.build ?? '')
    setConversationIds(current => ({
      ...current,
      build: null,
    }))
    setClearPreviewChat(true)
  }, [conversationIds.build, refreshDebugConversationAsync])

  if (buildDraft.isPending) {
    return (
      <AgentConfigurePageLoading label={t('agentDetail.sections.configure')} />
    )
  }

  const composerSessionKey = buildDraft.isActive
    ? `${agentId}:${buildDraft.activeVersionId ?? 'build-draft'}`
    : `${agentId}:${buildDraft.activeVersionId ?? 'draft'}:${composerRebaseRevision}`

  return (
    <AgentComposerProvider
      key={composerSessionKey}
      initialDraft={agentSoulConfigToFormState(buildDraft.agentSoulConfig)}
      initialOriginalConfig={buildDraft.agentSoulConfig}
    >
      <AgentConfigurePageComposerContent
        agentId={agentId}
        agentIconType={agentIconType}
        buildDraft={buildDraft}
        clearPreviewChat={clearPreviewChat}
        composerQuery={composerQuery}
        configureData={configureData}
        conversationIds={conversationIds}
        hideBuildDraftBarUntilRefresh={hideBuildDraftBarUntilRefresh}
        isRefreshingDebugConversation={isRefreshingDebugConversation}
        isViewingVersion={isViewingVersion}
        onRefreshDebugConversation={refreshDebugConversation}
        onResetBuildChatSession={resetBuildChatSession}
        onSelectVersion={onSelectVersion}
        onSetClearPreviewChat={setClearPreviewChat}
        onSetConversationIds={setConversationIds}
        onSetHideBuildDraftBarUntilRefresh={setHideBuildDraftBarUntilRefresh}
        onComposerRebase={onComposerRebase}
        onSetRightPanelMode={setRightPanelMode}
        onSetShowChatFeatures={setShowChatFeatures}
        onSetShowPreviewVersions={setShowPreviewVersions}
        rightPanelMode={rightPanelMode}
        showChatFeatures={showChatFeatures}
        showPreviewVersions={showPreviewVersions}
        workingDirectoryPanel={workingDirectoryPanel}
      />
    </AgentComposerProvider>
  )
}

function AgentConfigurePageComposerContent({
  agentId,
  agentIconType,
  buildDraft,
  clearPreviewChat,
  composerQuery,
  configureData,
  conversationIds,
  hideBuildDraftBarUntilRefresh,
  isRefreshingDebugConversation,
  isViewingVersion,
  onRefreshDebugConversation,
  onResetBuildChatSession,
  onSelectVersion,
  onSetClearPreviewChat,
  onSetConversationIds,
  onSetHideBuildDraftBarUntilRefresh,
  onComposerRebase,
  onSetRightPanelMode,
  onSetShowChatFeatures,
  onSetShowPreviewVersions,
  rightPanelMode,
  showChatFeatures,
  showPreviewVersions,
  workingDirectoryPanel,
}: AgentConfigurePageProps & {
  agentIconType?: AgentIconType | null
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
  clearPreviewChat: boolean
  composerQuery: ReturnType<typeof useAgentConfigureData>['composerQuery']
  configureData: ReturnType<typeof useAgentConfigureData>
  conversationIds: AgentConfigureConversationIds
  hideBuildDraftBarUntilRefresh: boolean
  isRefreshingDebugConversation: boolean
  isViewingVersion: boolean
  onRefreshDebugConversation: (conversationId: string) => void
  onResetBuildChatSession: () => Promise<void>
  onComposerRebase: () => void
  onSelectVersion: (versionId: string | null) => void
  onSetClearPreviewChat: (clearPreviewChat: boolean) => void
  onSetConversationIds: Dispatch<SetStateAction<AgentConfigureConversationIds>>
  onSetHideBuildDraftBarUntilRefresh: (hide: boolean) => void
  onSetRightPanelMode: (mode: AgentConfigureRightPanelMode) => void
  onSetShowChatFeatures: Dispatch<SetStateAction<boolean>>
  onSetShowPreviewVersions: (show: boolean) => void
  rightPanelMode: AgentConfigureRightPanelMode
  showChatFeatures: boolean
  showPreviewVersions: boolean
  workingDirectoryPanel: ReturnType<typeof useAgentWorkingDirectoryPanel>
}) {
  const {
    agentQuery,
    versionQuery,
    selectedVersionId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  } = configureData
  const rightPanelChatMode: AgentConfigureRightPanelMode = rightPanelMode === 'preview' ? 'build' : rightPanelMode
  const showBuildDraftBar = buildDraft.isActive && !hideBuildDraftBarUntilRefresh
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
    resetBuildChatSession: onResetBuildChatSession,
    saveDraft,
    onComposerRebased: onComposerRebase,
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const selectVersion = useCallback((versionId: string | null) => {
    buildDraft.setSoulSourceOverride(versionId ? 'view-version' : null)
    onSelectVersion(versionId)
  }, [buildDraft, onSelectVersion])
  const restartCurrentChat = () => {
    if (rightPanelChatMode === 'build' && buildDraft.isActive) {
      void buildDraftActions.discardBuildDraft()
      return
    }

    if (rightPanelChatMode === 'build')
      onRefreshDebugConversation(conversationIds.build ?? '')

    onSetConversationIds(current => ({
      ...current,
      [rightPanelChatMode]: null,
    }))
    onSetClearPreviewChat(true)
  }

  return (
    <AgentConfigureWorkspace
      aria-busy={agentQuery.isFetching}
      leftPanel={(
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
          bottomAction={showBuildDraftBar
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
          onOpenVersions={() => {
            workingDirectoryPanel.closeWorkingDirectory()
            onSetShowPreviewVersions(true)
          }}
          onExitVersions={() => selectVersion(null)}
        />
      )}
      rightPanel={(
        <AgentConfigurePreviewSurface
          background={<AgentBuildPanelBackground visible={rightPanelChatMode === 'build'} />}
          header={(
            <AgentPreviewHeader
              mode={rightPanelChatMode}
              previewEnabled={false}
              isChatFeaturesOpen={showChatFeatures}
              onModeChange={onSetRightPanelMode}
              onToggleChatFeatures={() => onSetShowChatFeatures(open => !open)}
              onOpenWorkingDirectory={() => {
                onSetShowPreviewVersions(false)
                workingDirectoryPanel.openWorkingDirectory()
              }}
              onRefresh={restartCurrentChat}
              refreshDisabled={isRefreshingDebugConversation || buildDraftActions.isDiscardingBuildDraft}
            />
          )}
          chat={(
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
              onClearChatListChange={onSetClearPreviewChat}
              onConversationComplete={(mode) => {
                if (mode === 'build')
                  buildDraftActions.refreshBuildDraftAfterBuildChat(() => onSetHideBuildDraftBarUntilRefresh(false))
              }}
              onConversationIdChange={(mode, conversationId) => {
                onSetConversationIds(current => ({
                  ...current,
                  [mode]: conversationId,
                }))
              }}
              onSaveDraftBeforeRun={rightPanelChatMode === 'build'
                ? async () => {
                  onSetHideBuildDraftBarUntilRefresh(true)
                  await buildDraftActions.prepareBuildDraftBeforeRun()
                }
                : saveDraft}
            />
          )}
        />
      )}
      sidePanels={(
        <>
          {showPreviewVersions && (
            <AgentPreviewVersionsPanel
              agentId={agentId}
              activeVersionId={activeVersionId}
              onSelectVersion={selectVersion}
              onClose={() => onSetShowPreviewVersions(false)}
            />
          )}
          {workingDirectoryPanel.panel}
          <AgentChatFeaturesPanel
            show={showChatFeatures}
            appFeatures={agentSoulConfig?.app_features}
            disabled={versionQuery.isPending}
            onClose={() => onSetShowChatFeatures(false)}
          />
        </>
      )}
    />
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

function AgentConfigurePageLoading({
  label,
}: {
  label: string
}) {
  return (
    <section
      aria-label={label}
      aria-busy
      className="flex h-full min-w-0 flex-1 bg-background-body"
    >
      <Loading type="app" />
    </section>
  )
}
