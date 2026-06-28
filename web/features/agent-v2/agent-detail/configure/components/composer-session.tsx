'use client'

import type { AgentAppDetailWithSite, AgentIconType } from '@dify/contracts/api/console/agent/types.gen'
import type { Dispatch, SetStateAction } from 'react'
import type { useAgentConfigureData } from '../hooks'
import type { AgentConfigureConversationIds, AgentConfigureRightPanelMode } from './preview/right-panel-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/client'
import { useAgentConfigureModelOptions } from '../hooks'
import { useAgentConfigureBuildDraftActions, useAgentConfigureBuildDraftData } from '../use-agent-configure-build-draft'
import { useAgentConfigureSync } from '../use-agent-configure-sync'
import { AgentOrchestratePanel } from './orchestrate'
import { AgentBuildDraftBar } from './orchestrate/build-draft-bar'
import { AgentConfigurePageLoading } from './page-loading'
import { AgentBuildPanelBackground } from './preview/build-background'
import { AgentChatFeaturesPanel } from './preview/chat-features-panel'
import { AgentPreviewHeader } from './preview/header'
import { AgentConfigureRightPanelChat } from './preview/right-panel-chat'
import { useAgentWorkingDirectoryPanel } from './preview/use-working-directory-panel'
import { AgentPreviewVersionsPanel } from './preview/versions-panel'
import { AgentConfigurePreviewSurface, AgentConfigureWorkspace } from './workspace'

type DebugConversationRefreshInput = {
  params: {
    agent_id: string
  }
  body: {
    debug_conversation_id: string
  }
}

export function AgentConfigureComposerScope({
  agentId,
  composerRebaseRevision,
  configureData,
  onComposerRebase,
  onSelectVersion,
}: {
  agentId: string
  composerRebaseRevision: number
  configureData: ReturnType<typeof useAgentConfigureData>
  onComposerRebase: () => void
  onSelectVersion: (versionId: string | null) => void
}) {
  const { t } = useTranslation('agentV2')
  const {
    composerQuery,
    selectedVersionId,
    activeVersionId,
    agentSoulConfig,
  } = configureData
  const isViewingVersion = !!selectedVersionId
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    activeVersionId,
    composerAgentSoulConfig: composerQuery.data?.agent_soul,
    isViewingVersion,
    normalAgentSoulConfig: agentSoulConfig,
  })

  if (buildDraft.isPending) {
    return (
      <AgentConfigurePageLoading label={t('agentDetail.sections.configure')} />
    )
  }

  const composerSessionKey = buildDraft.isActive
    ? `${agentId}:${buildDraft.activeVersionId ?? 'build-draft'}`
    : `${agentId}:${buildDraft.activeVersionId ?? 'draft'}:${composerRebaseRevision}`

  return (
    <AgentConfigurePageComposerSession
      agentId={agentId}
      buildDraft={buildDraft}
      composerSessionKey={composerSessionKey}
      configureData={configureData}
      isViewingVersion={isViewingVersion}
      onComposerRebase={onComposerRebase}
      onSelectVersion={onSelectVersion}
    />
  )
}

function AgentConfigurePageComposerSession({
  agentId,
  buildDraft,
  composerSessionKey,
  configureData,
  isViewingVersion,
  onComposerRebase,
  onSelectVersion,
}: {
  agentId: string
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
  composerSessionKey: string
  configureData: ReturnType<typeof useAgentConfigureData>
  isViewingVersion: boolean
  onComposerRebase: () => void
  onSelectVersion: (versionId: string | null) => void
}) {
  const {
    agentQuery,
  } = configureData
  const queryClient = useQueryClient()
  const [showChatFeatures, setShowChatFeatures] = useState(false)
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<AgentConfigureRightPanelMode>('build')
  const [hideBuildDraftBarUntilRefresh, setHideBuildDraftBarUntilRefresh] = useState(false)
  const [conversationIds, setConversationIds] = useState<AgentConfigureConversationIds>({
    build: agentQuery.data?.debug_conversation_id ?? null,
    preview: null,
  })
  const agentIconType = agentQuery.data?.icon_type as AgentIconType | null | undefined
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
    try {
      await refreshDebugConversationAsync(conversationIds.build ?? '')
    }
    finally {
      setConversationIds(current => ({
        ...current,
        build: null,
      }))
      setClearPreviewChat(true)
    }
  }, [conversationIds.build, refreshDebugConversationAsync])

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
        configureData={configureData}
        conversationIds={conversationIds}
        hideBuildDraftBarUntilRefresh={hideBuildDraftBarUntilRefresh}
        isRefreshingDebugConversation={isRefreshingDebugConversation}
        isViewingVersion={isViewingVersion}
        resetBuildChatSession={resetBuildChatSession}
        rightPanelMode={rightPanelMode}
        setClearPreviewChat={setClearPreviewChat}
        setConversationIds={setConversationIds}
        setHideBuildDraftBarUntilRefresh={setHideBuildDraftBarUntilRefresh}
        setRightPanelMode={setRightPanelMode}
        setShowChatFeatures={setShowChatFeatures}
        setShowPreviewVersions={setShowPreviewVersions}
        showChatFeatures={showChatFeatures}
        showPreviewVersions={showPreviewVersions}
        workingDirectoryPanel={workingDirectoryPanel}
        onComposerRebase={onComposerRebase}
        onRefreshDebugConversation={refreshDebugConversation}
        onSelectVersion={onSelectVersion}
      />
    </AgentComposerProvider>
  )
}

function AgentConfigurePageComposerContent({
  agentId,
  agentIconType,
  buildDraft,
  clearPreviewChat,
  configureData,
  conversationIds,
  hideBuildDraftBarUntilRefresh,
  isRefreshingDebugConversation,
  isViewingVersion,
  resetBuildChatSession,
  rightPanelMode,
  setClearPreviewChat,
  setConversationIds,
  setHideBuildDraftBarUntilRefresh,
  setRightPanelMode,
  setShowChatFeatures,
  setShowPreviewVersions,
  showChatFeatures,
  showPreviewVersions,
  workingDirectoryPanel,
  onComposerRebase,
  onRefreshDebugConversation,
  onSelectVersion,
}: {
  agentId: string
  agentIconType: AgentIconType | null | undefined
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
  clearPreviewChat: boolean
  configureData: ReturnType<typeof useAgentConfigureData>
  conversationIds: AgentConfigureConversationIds
  hideBuildDraftBarUntilRefresh: boolean
  isRefreshingDebugConversation: boolean
  isViewingVersion: boolean
  resetBuildChatSession: () => Promise<void>
  rightPanelMode: AgentConfigureRightPanelMode
  setClearPreviewChat: Dispatch<SetStateAction<boolean>>
  setConversationIds: Dispatch<SetStateAction<AgentConfigureConversationIds>>
  setHideBuildDraftBarUntilRefresh: Dispatch<SetStateAction<boolean>>
  setRightPanelMode: Dispatch<SetStateAction<AgentConfigureRightPanelMode>>
  setShowChatFeatures: Dispatch<SetStateAction<boolean>>
  setShowPreviewVersions: Dispatch<SetStateAction<boolean>>
  showChatFeatures: boolean
  showPreviewVersions: boolean
  workingDirectoryPanel: ReturnType<typeof useAgentWorkingDirectoryPanel>
  onComposerRebase: () => void
  onRefreshDebugConversation: (conversationId: string) => void
  onSelectVersion: (versionId: string | null) => void
}) {
  const {
    agentQuery,
    composerQuery,
    versionQuery,
    selectedVersionId,
    activeVersionId,
    activeVersionSnapshot,
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
    resetBuildChatSession,
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

    setConversationIds(current => ({
      ...current,
      [rightPanelChatMode]: null,
    }))
    setClearPreviewChat(true)
  }

  return (
    <AgentConfigureWorkspace
      aria-busy={agentQuery.isFetching}
      leftPanel={(
        <AgentOrchestratePanel
          agentId={agentId}
          activeConfigIsPublished={agentQuery.data?.active_config_is_published}
          activeVersionSnapshot={activeVersionSnapshot}
          agentSoulConfig={buildDraft.agentSoulConfig}
          agentName={agentQuery.data?.name}
          currentModel={currentModel}
          textGenerationModelList={textGenerationModelList}
          draftSavedAt={draftSavedAt}
          isPublishing={isPublishing}
          readOnly={isViewingVersion || buildDraft.isActive}
          selectedVersionSnapshot={isViewingVersion ? activeVersionSnapshot : undefined}
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
            setShowPreviewVersions(true)
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
              onModeChange={setRightPanelMode}
              onToggleChatFeatures={() => setShowChatFeatures(open => !open)}
              onOpenWorkingDirectory={() => {
                setShowPreviewVersions(false)
                workingDirectoryPanel.openWorkingDirectory()
              }}
              onRefresh={restartCurrentChat}
              refreshDisabled={isRefreshingDebugConversation || buildDraftActions.isDiscardingBuildDraft}
            />
          )}
          chat={(
            <AgentConfigureRightPanelChat
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
              onConversationComplete={(mode) => {
                if (mode === 'build')
                  buildDraftActions.refreshBuildDraftAfterBuildChat(() => setHideBuildDraftBarUntilRefresh(false))
              }}
              onConversationIdChange={(mode, conversationId) => {
                setConversationIds(current => ({
                  ...current,
                  [mode]: conversationId,
                }))
              }}
              onSaveDraftBeforeRun={rightPanelChatMode === 'build'
                ? async () => {
                  setHideBuildDraftBarUntilRefresh(true)
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
              onClose={() => setShowPreviewVersions(false)}
            />
          )}
          {workingDirectoryPanel.panel}
          <AgentChatFeaturesPanel
            show={showChatFeatures}
            appFeatures={agentSoulConfig?.app_features}
            disabled={versionQuery.isPending}
            onClose={() => setShowChatFeatures(false)}
          />
        </>
      )}
    />
  )
}
