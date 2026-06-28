'use client'

import type { AgentIconType } from '@dify/contracts/api/console/agent/types.gen'
import type { useAgentConfigureData } from '../hooks'
import type { AgentConfigureRightPanelMode } from './preview/right-panel-chat'
import { useCallback, useState } from 'react'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useAgentConfigureModelOptions } from '../hooks'
import { useAgentConfigureBuildDraftActions } from '../use-agent-configure-build-draft'
import { useAgentConfigureSync } from '../use-agent-configure-sync'
import { AgentOrchestratePanel } from './orchestrate'
import { AgentBuildDraftBar } from './orchestrate/build-draft-bar'
import { AgentBuildPanelBackground } from './preview/build-background'
import { AgentChatFeaturesPanel } from './preview/chat-features-panel'
import { AgentPreviewHeader } from './preview/header'
import { useAgentConfigureChat } from './preview/hook/use-chat-hook'
import { useAgentWorkingDirectoryPanel } from './preview/hook/use-working-directory-panel'
import { AgentConfigureRightPanelChat } from './preview/right-panel-chat'
import { AgentPreviewVersionsPanel } from './preview/versions-panel'
import { AgentConfigurePreviewSurface, AgentConfigureWorkspace } from './workspace'

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
  const {
    selectedVersionId,
    activeVersionId,
    buildDraft,
  } = configureData
  const isViewingVersion = !!selectedVersionId

  const composerSessionKey = buildDraft.isActive
    ? `${agentId}:${activeVersionId ?? 'build-draft'}`
    : `${agentId}:${activeVersionId ?? 'draft'}:${composerRebaseRevision}`

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
  buildDraft: ReturnType<typeof useAgentConfigureData>['buildDraft']
  composerSessionKey: string
  configureData: ReturnType<typeof useAgentConfigureData>
  isViewingVersion: boolean
  onComposerRebase: () => void
  onSelectVersion: (versionId: string | null) => void
}) {
  const {
    agentQuery,
    agentSoulConfig,
  } = configureData
  const agentIconType = agentQuery.data?.icon_type as AgentIconType | null | undefined
  const chatConversations = useAgentConfigureChat({
    agentId,
    initialDebugConversationId: agentQuery.data?.debug_conversation_id,
  })

  return (
    <AgentComposerProvider
      key={composerSessionKey}
      initialDraft={agentSoulConfigToFormState(agentSoulConfig)}
      initialOriginalConfig={agentSoulConfig}
    >
      <AgentConfigurePageComposerContent
        agentId={agentId}
        agentIconType={agentIconType}
        buildDraft={buildDraft}
        chatConversations={chatConversations}
        configureData={configureData}
        isViewingVersion={isViewingVersion}
        onComposerRebase={onComposerRebase}
        onSelectVersion={onSelectVersion}
      />
    </AgentComposerProvider>
  )
}

function AgentConfigurePageComposerContent({
  agentId,
  agentIconType,
  buildDraft,
  chatConversations,
  configureData,
  isViewingVersion,
  onComposerRebase,
  onSelectVersion,
}: {
  agentId: string
  agentIconType: AgentIconType | null | undefined
  buildDraft: ReturnType<typeof useAgentConfigureData>['buildDraft']
  chatConversations: ReturnType<typeof useAgentConfigureChat>
  configureData: ReturnType<typeof useAgentConfigureData>
  isViewingVersion: boolean
  onComposerRebase: () => void
  onSelectVersion: (versionId: string | null) => void
}) {
  const {
    agentQuery,
    composerQuery,
    versionQuery,
    selectedVersionId,
    activeVersionId,
    agentSoulConfig,
  } = configureData
  const [showChatFeatures, setShowChatFeatures] = useState(false)
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<AgentConfigureRightPanelMode>('build')
  const [hideBuildDraftBarUntilRefresh, setHideBuildDraftBarUntilRefresh] = useState(false)
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
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
    resetBuildChatSession: chatConversations.resetBuildChatSession,
    saveDraft,
    onComposerRebased: onComposerRebase,
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const selectVersion = useCallback((versionId: string | null) => {
    buildDraft.setSoulSourceOverride(versionId ? 'view-version' : null)
    onSelectVersion(versionId)
  }, [buildDraft, onSelectVersion])
  const openPreviewVersions = useCallback(() => {
    workingDirectoryPanel.closeWorkingDirectory()
    setShowPreviewVersions(true)
  }, [workingDirectoryPanel])
  const restartCurrentChat = () => {
    if (rightPanelChatMode === 'build' && buildDraft.isActive) {
      void buildDraftActions.discardBuildDraft()
      return
    }

    if (rightPanelChatMode === 'build')
      chatConversations.refreshDebugConversation(chatConversations.conversationIds.build ?? '')

    chatConversations.setConversationIds(current => ({
      ...current,
      [rightPanelChatMode]: null,
    }))
    chatConversations.setClearPreviewChat(true)
  }

  return (
    <AgentConfigureWorkspace
      aria-busy={agentQuery.isFetching}
      leftPanel={(
        <AgentOrchestratePanel
          agentId={agentId}
          configureData={configureData}
          agentSoulConfig={agentSoulConfig}
          currentModel={currentModel}
          textGenerationModelList={textGenerationModelList}
          draftSavedAt={draftSavedAt}
          isPublishing={isPublishing}
          readOnly={isViewingVersion || buildDraft.isActive}
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
          onOpenVersions={openPreviewVersions}
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
              refreshDisabled={chatConversations.isRefreshingDebugConversation || buildDraftActions.isDiscardingBuildDraft}
            />
          )}
          chat={(
            <AgentConfigureRightPanelChat
              agentId={agentId}
              agentIcon={agentQuery.data?.icon}
              agentIconBackground={agentQuery.data?.icon_background}
              agentIconType={agentIconType}
              agentName={agentQuery.data?.name}
              agentSoulConfig={agentSoulConfig}
              clearChatList={chatConversations.clearPreviewChat}
              conversationIds={chatConversations.conversationIds}
              draftType={rightPanelChatMode === 'build' ? 'debug_build' : undefined}
              mode={rightPanelChatMode}
              onClearChatListChange={chatConversations.setClearPreviewChat}
              onConversationComplete={(mode) => {
                if (mode === 'build')
                  buildDraftActions.refreshBuildDraftAfterBuildChat(() => setHideBuildDraftBarUntilRefresh(false))
              }}
              onConversationIdChange={(mode, conversationId) => {
                chatConversations.setConversationIds(current => ({
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
