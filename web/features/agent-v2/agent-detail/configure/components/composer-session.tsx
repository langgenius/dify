'use client'

import type {
  AgentAppDetailWithSite,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type { useAgentConfigureData } from '../hooks'
import type { AgentConfigureRightPanelMode } from '../state'
import type { AgentPreviewChatController } from './preview/chat-conversation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { rebaseAgentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import {
  AgentScope,
  trackAgentBuildModeRun,
  trackAgentPreviewModeRun,
} from '@/features/agent-v2/analytics'
import { consoleQuery } from '@/service/console'
import {
  agentConfigureConversationIdsAtom,
  agentConfigureShowChatFeaturesAtom,
  agentConfigureShowPreviewVersionsAtom,
  agentConfigureSoulSourceOverrideAtom,
  resetAgentConfigureConversationAtom,
  setAgentConfigureConversationIdAtom,
} from '../state'
import {
  useAgentConfigureBuildDraftActions,
  useAgentConfigureBuildDraftData,
} from '../use-agent-configure-build-draft'
import { useAgentConfigureSessionController } from '../use-agent-configure-session-controller'
import { useAgentConfigureSync } from '../use-agent-configure-sync'
import { AgentConfigureClearSessionConfirmDialog } from './confirm-clear-session-dialog'
import { AgentOrchestratePanel } from './orchestrate'
import { AgentBuildDraftBar } from './orchestrate/build-draft-bar'
import { AgentConfigurePageLoading } from './page-loading'
import { AgentBuildPanelBackground } from './preview/build-background'
import { AgentChatFeaturesPanel } from './preview/chat-features-panel'
import { AgentPreviewHeader } from './preview/header'
import { AgentConfigureRightPanelChat } from './preview/right-panel-chat'
import { AgentConfigurePreviewBody, AgentConfigurePreviewSurface } from './preview/surface'
import { AgentPreviewVersionsPanel } from './preview/versions-panel'
import { invalidateAgentWorkingDirectoryFiles } from './preview/working-directory-cache'
import { AgentWorkingDirectoryPanel } from './preview/working-directory-panel'

export function AgentConfigureComposerScope({
  agentId,
  composerRebaseRevision,
  configureData,
  previewEnabled,
  rightPanelMode,
  onComposerRebase,
  onRightPanelModeChange,
  onSelectVersion,
}: {
  agentId: string
  composerRebaseRevision: number
  configureData: ReturnType<typeof useAgentConfigureData>
  previewEnabled: boolean
  rightPanelMode: AgentConfigureRightPanelMode
  onComposerRebase: () => void
  onRightPanelModeChange: (mode: AgentConfigureRightPanelMode) => void | Promise<unknown>
  onSelectVersion: (versionId: string | null) => void
}) {
  const { t } = useTranslation(['agentV2'])
  const { composerQuery, selectedVersionId, activeVersionId, agentSoulConfig } = configureData
  const soulSourceOverride = useAtomValue(agentConfigureSoulSourceOverrideAtom)
  const setSoulSourceOverride = useSetAtom(agentConfigureSoulSourceOverrideAtom)
  const initializedComposerAgentIdRef = useRef<string | null>(null)
  const isViewingVersion = !!selectedVersionId
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    activeVersionId,
    composerAgentSoulConfig: composerQuery.data?.agent_soul,
    isBuildMode: configureData.capabilities.canBuild && rightPanelMode === 'build',
    isViewingVersion,
    normalAgentSoulConfig: agentSoulConfig,
    setSoulSourceOverride,
    soulSourceOverride,
  })
  useEffect(() => {
    if (!buildDraft.isPending) initializedComposerAgentIdRef.current = agentId
  }, [agentId, buildDraft.isPending])

  if (
    configureData.isPending ||
    (buildDraft.isPending && initializedComposerAgentIdRef.current !== agentId)
  ) {
    return <AgentConfigurePageLoading label={t(($) => $['agentDetail.sections.configure'])} />
  }

  const composerHydrationState = composerQuery.data === undefined ? 'unavailable' : 'loaded'
  const composerSessionKey = `${agentId}:${activeVersionId ?? selectedVersionId ?? 'draft'}:${composerHydrationState}:${composerRebaseRevision}`

  return (
    <AgentConfigurePageComposerSession
      agentId={agentId}
      buildDraft={buildDraft}
      composerSessionKey={composerSessionKey}
      configureData={configureData}
      isViewingVersion={isViewingVersion}
      previewEnabled={previewEnabled}
      rightPanelMode={rightPanelMode}
      onComposerRebase={onComposerRebase}
      onRightPanelModeChange={onRightPanelModeChange}
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
  previewEnabled,
  rightPanelMode,
  onComposerRebase,
  onRightPanelModeChange,
  onSelectVersion,
}: {
  agentId: string
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
  composerSessionKey: string
  configureData: ReturnType<typeof useAgentConfigureData>
  isViewingVersion: boolean
  previewEnabled: boolean
  rightPanelMode: AgentConfigureRightPanelMode
  onComposerRebase: () => void
  onRightPanelModeChange: (mode: AgentConfigureRightPanelMode) => void | Promise<unknown>
  onSelectVersion: (versionId: string | null) => void
}) {
  const { agentQuery, agentSoulConfig } = configureData
  const queryClient = useQueryClient()
  const sessionController = useAgentConfigureSessionController({
    buildDraftAgentSoulConfig: buildDraft.buildDraftAgentSoulConfig,
    hasActiveBuildDraft: buildDraft.hasActiveBuildDraft,
    isBuildDraftActive: buildDraft.isActive,
    mode: rightPanelMode,
    normalAgentSoulConfig: agentSoulConfig,
    onModeChange: onRightPanelModeChange,
  })
  const refreshDebugConversationMutation = useMutation(
    consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions({
      onSuccess: ({
        debug_conversation_id,
        debug_conversation_has_messages,
        debug_conversation_message_count,
      }) => {
        queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
          consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
          (agentDetail) => {
            if (!agentDetail) return agentDetail

            return {
              ...agentDetail,
              debug_conversation_id,
              debug_conversation_has_messages: debug_conversation_has_messages ?? false,
              debug_conversation_message_count: debug_conversation_message_count ?? 0,
            }
          },
        )
      },
    }),
  )
  const {
    mutate: refreshDebugConversationRequest,
    mutateAsync: refreshDebugConversationRequestAsync,
    isPending: isRefreshingBuildConversation,
  } = refreshDebugConversationMutation
  const refreshDebugConversation = () => {
    refreshDebugConversationRequest({ params: { agent_id: agentId } })
  }
  const refreshDebugConversationAsync = useCallback(
    () => refreshDebugConversationRequestAsync({ params: { agent_id: agentId } }),
    [agentId, refreshDebugConversationRequestAsync],
  )

  return (
    <ScopeProvider
      atoms={[
        [
          agentConfigureConversationIdsAtom,
          {
            build: agentQuery.data?.debug_conversation_id ?? null,
            preview: null,
          },
        ],
      ]}
      name="AgentConfigureConversation"
    >
      <AgentComposerProvider
        key={composerSessionKey}
        initialDraft={agentSoulConfigToFormState(buildDraft.agentSoulConfig)}
      >
        <AgentConfigurePageComposerContent
          agentId={agentId}
          buildDraft={buildDraft}
          configureData={configureData}
          isRefreshingDebugConversation={isRefreshingBuildConversation}
          isViewingVersion={isViewingVersion}
          previewEnabled={previewEnabled}
          rightPanelMode={rightPanelMode}
          sessionController={sessionController}
          onComposerRebase={onComposerRebase}
          onRefreshDebugConversation={refreshDebugConversation}
          onRefreshDebugConversationAsync={refreshDebugConversationAsync}
          onSelectVersion={onSelectVersion}
        />
      </AgentComposerProvider>
    </ScopeProvider>
  )
}

function AgentConfigurePageComposerContent({
  agentId,
  buildDraft,
  configureData,
  isRefreshingDebugConversation,
  isViewingVersion,
  previewEnabled,
  rightPanelMode,
  sessionController,
  onComposerRebase,
  onRefreshDebugConversation,
  onRefreshDebugConversationAsync,
  onSelectVersion,
}: {
  agentId: string
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
  configureData: ReturnType<typeof useAgentConfigureData>
  isRefreshingDebugConversation: boolean
  isViewingVersion: boolean
  previewEnabled: boolean
  rightPanelMode: AgentConfigureRightPanelMode
  sessionController: ReturnType<typeof useAgentConfigureSessionController>
  onComposerRebase: () => void
  onRefreshDebugConversation: () => void
  onRefreshDebugConversationAsync: () => Promise<unknown>
  onSelectVersion: (versionId: string | null) => void
}) {
  const {
    capabilities,
    agentQuery,
    composerQuery,
    versionQuery,
    selectedVersionId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  } = configureData
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['modelProvider'])
  const [clearChatByMode, setClearChatByMode] = useState<
    Record<AgentConfigureRightPanelMode, boolean>
  >({
    build: false,
    preview: false,
  })
  const [completedBuildConversationId, setCompletedBuildConversationId] = useState<string | null>(
    null,
  )
  const rightPanelChatControllerRef = useRef<AgentPreviewChatController>(null)
  const conversationIds = useAtomValue(agentConfigureConversationIdsAtom)
  const rightPanelChatMode = rightPanelMode
  const [showWorkingDirectory, setShowWorkingDirectory] = useState(false)
  const workingDirectoryCallerId =
    rightPanelChatMode === 'build' ? buildDraft.id : conversationIds.preview

  const showChatFeatures = useAtomValue(agentConfigureShowChatFeaturesAtom)
  const showPreviewVersions = useAtomValue(agentConfigureShowPreviewVersionsAtom)
  const resetConversation = useSetAtom(resetAgentConfigureConversationAtom)
  const setConversationId = useSetAtom(setAgentConfigureConversationIdAtom)
  const setShowChatFeatures = useSetAtom(agentConfigureShowChatFeaturesAtom)
  const setShowPreviewVersions = useSetAtom(agentConfigureShowPreviewVersionsAtom)
  const rebaseComposerDraft = useSetAtom(rebaseAgentComposerDraftAtom)
  const queryClient = useQueryClient()
  const showBuildDraftBar = capabilities.canBuild && buildDraft.isActive
  const resetBuildChatState = useCallback(async () => {
    setCompletedBuildConversationId(null)
    setConversationId({ mode: 'build', conversationId: null })
    setClearChatByMode((current) => ({ ...current, build: true }))
    await onRefreshDebugConversationAsync()
  }, [onRefreshDebugConversationAsync, setClearChatByMode, setConversationId])
  const rebaseComposerDraftFromSoulConfig = useCallback(
    (agentSoulConfig?: AgentSoulConfig) => {
      rebaseComposerDraft({
        draft: agentSoulConfigToFormState(agentSoulConfig),
      })
    },
    [rebaseComposerDraft],
  )
  const [currentModel, setConfigureModel] = useAtom(agentComposerModelAtom)
  const { isPublishing, publishDraft, saveDraft } = useAgentConfigureSync({
    agentId,
    agentName: agentQuery.data?.name,
    baseConfig: agentSoulConfig,
    enabled:
      capabilities.canEdit && composerQuery.isSuccess && !selectedVersionId && !buildDraft.isActive,
    publishEnabled:
      capabilities.canReleaseAndVersion &&
      composerQuery.isSuccess &&
      !selectedVersionId &&
      !buildDraft.isActive,
  })
  const {
    buildCallbackGeneration,
    buildDraftActionsDisabled,
    changeMode,
    confirmSwitchToPreview: confirmSessionSwitchToPreview,
    finishBuildAction,
    isEnteringBuildMode,
    isBuildCallbackCurrent,
    resetBuildSession: resetSessionController,
    resetBuildSessionState,
    runBuildPreparation,
    setShowSwitchToPreviewConfirm,
    showSwitchToPreviewConfirm,
    waitForPendingPreviewDraftSave,
  } = sessionController
  const resetBuildSession = useCallback(
    () => resetSessionController(resetBuildChatState),
    [resetBuildChatState, resetSessionController],
  )
  const saveDraftBeforeBuildRun = useCallback(async () => {
    await waitForPendingPreviewDraftSave()
    await saveDraft()
  }, [saveDraft, waitForPendingPreviewDraftSave])
  const buildDraftActions = useAgentConfigureBuildDraftActions({
    agentId,
    buildDraftAgentSoulConfig: buildDraft.agentSoulConfig,
    isActive: buildDraft.isActive,
    normalAgentSoulConfig: agentSoulConfig,
    rebaseComposerDraft: rebaseComposerDraftFromSoulConfig,
    refetchBuildDraft: buildDraft.refetch,
    refetchComposer: composerQuery.refetch,
    resetBuildChatSession: resetBuildSession,
    saveDraft: saveDraftBeforeBuildRun,
    onComposerRebased: onComposerRebase,
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const stopBuildChat = useCallback(() => {
    rightPanelChatControllerRef.current?.stop()
  }, [])
  const changeRightPanelMode = useCallback(
    (nextMode: AgentConfigureRightPanelMode) =>
      changeMode(nextMode, {
        discardBuildDraft: buildDraftActions.discardBuildDraft,
        rebaseComposerDraft: rebaseComposerDraftFromSoulConfig,
        savePreviewDraft: saveDraft,
        startFreshBuildSession: buildDraftActions.startFreshBuildSession,
        stopBuildChat,
      }),
    [
      buildDraftActions.discardBuildDraft,
      buildDraftActions.startFreshBuildSession,
      changeMode,
      rebaseComposerDraftFromSoulConfig,
      saveDraft,
      stopBuildChat,
    ],
  )
  const confirmSwitchToPreview = useCallback(
    () => confirmSessionSwitchToPreview(buildDraftActions.discardBuildDraft, stopBuildChat),
    [buildDraftActions.discardBuildDraft, confirmSessionSwitchToPreview, stopBuildChat],
  )
  const selectVersion = useCallback(
    (versionId: string | null) => {
      onSelectVersion(versionId)
    },
    [onSelectVersion],
  )
  const hasRestartCurrentChatTarget =
    rightPanelChatMode === 'build'
      ? (agentQuery.data?.debug_conversation_has_messages ?? false) || buildDraft.isActive
      : !!conversationIds[rightPanelChatMode]
  const isRestartCurrentChatDisabled =
    !capabilities.canTestAndRun ||
    !hasRestartCurrentChatTarget ||
    buildDraftActionsDisabled ||
    isEnteringBuildMode ||
    isRefreshingDebugConversation ||
    buildDraftActions.isApplyingBuildDraft ||
    buildDraftActions.isDiscardingBuildDraft
  const isChatFeaturesReadOnly =
    !capabilities.canEdit ||
    isEnteringBuildMode ||
    buildDraftActionsDisabled ||
    (isViewingVersion && versionQuery.isPending) ||
    buildDraft.isActive
  const buildConversationHasAgentResponse =
    !!conversationIds.build &&
    (conversationIds.build === completedBuildConversationId ||
      (conversationIds.build === agentQuery.data?.debug_conversation_id &&
        (agentQuery.data?.debug_conversation_has_messages ?? false)))
  const showWorkingDirectoryAction =
    rightPanelChatMode === 'build' && !!buildDraft.id && buildConversationHasAgentResponse
  const restartCurrentChat = () => {
    if (isRestartCurrentChatDisabled) return

    if (rightPanelChatMode === 'build' && buildDraft.isActive) {
      void buildDraftActions.discardBuildDraft()
      return
    }

    if (rightPanelChatMode === 'build') {
      resetBuildSessionState()
      onRefreshDebugConversation()
    }

    resetConversation(rightPanelChatMode)
    setClearChatByMode((current) => ({ ...current, [rightPanelChatMode]: true }))
  }

  const handleConversationComplete = (
    mode: 'build' | 'preview',
    completedConversationId: string,
  ) => {
    if (mode !== 'build' || !isBuildCallbackCurrent(buildCallbackGeneration)) return

    setCompletedBuildConversationId(completedConversationId)
    invalidateAgentWorkingDirectoryFiles({
      conversationId: completedConversationId,
      queryClient,
    })
    buildDraftActions.refreshBuildDraftAfterBuildChat(() =>
      finishBuildAction(buildCallbackGeneration),
    )
  }
  const handleConversationIdChange = (mode: 'build' | 'preview', conversationId: string) => {
    if (mode === 'build' && !isBuildCallbackCurrent(buildCallbackGeneration)) return
    setConversationId({ mode, conversationId })
  }
  const saveDraftBeforeChatRun =
    rightPanelChatMode === 'build'
      ? async () => {
          if (!currentModel?.provider || !currentModel.model) {
            toast.error(
              tCommon(($) => $['modelProvider.selectModel'], {
                ns: 'modelProvider',
              }),
            )
            throw new Error('Agent model is required.')
          }

          const preparedBuildDraft = await runBuildPreparation({
            generation: buildCallbackGeneration,
            markBuildChatStarted: true,
            prepare: buildDraftActions.prepareBuildDraftBeforeRun,
          })
          trackAgentBuildModeRun(AgentScope.Global)
          return preparedBuildDraft
        }
      : async () => {
          await saveDraft()
          trackAgentPreviewModeRun(AgentScope.Global)
        }
  const handleSendInterrupted = () => {
    if (rightPanelChatMode === 'build') finishBuildAction(buildCallbackGeneration)
  }

  return (
    <>
      <section
        aria-busy={agentQuery.isFetching || isEnteringBuildMode}
        className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden bg-background-body p-1 max-xl:flex-col max-xl:overflow-y-auto"
      >
        <AgentOrchestratePanel
          className="max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] max-xl:h-100 max-xl:w-full max-xl:max-w-none max-xl:min-w-0 max-xl:flex-none"
          agentId={agentId}
          agentName={agentQuery.data?.name}
          currentModel={currentModel}
          isPublishing={isPublishing}
          readOnly={
            !capabilities.canEdit ||
            !composerQuery.isSuccess ||
            isViewingVersion ||
            buildDraft.isActive ||
            buildDraftActionsDisabled
          }
          selectedVersionSnapshot={isViewingVersion ? activeConfigSnapshot : undefined}
          isBuildDraftActive={buildDraft.isActive}
          buildDraftChangedKeys={buildDraft.changedKeys}
          showPublishBar={capabilities.canReleaseAndVersion && !buildDraft.isActive}
          bottomAction={
            showBuildDraftBar ? (
              <AgentBuildDraftBar
                changeSummary={buildDraft.changeSummary}
                changesCount={buildDraft.changesCount}
                disabled={buildDraftActionsDisabled}
                isApplying={buildDraftActions.isApplyingBuildDraft}
                isDiscarding={buildDraftActions.isDiscardingBuildDraft}
                onApply={() => {
                  void buildDraftActions.applyBuildDraft()
                }}
                onDiscard={() => {
                  void buildDraftActions.discardBuildDraft()
                }}
              />
            ) : undefined
          }
          onSelectModel={setConfigureModel}
          onPublish={publishDraft}
          onOpenVersions={() => {
            setShowWorkingDirectory(false)
            setShowPreviewVersions(true)
          }}
          onExitVersions={() => selectVersion(null)}
          onVersionRestored={async () => {
            await composerQuery.refetch()
            onComposerRebase()
          }}
        />
        <div className="flex min-w-105 flex-1 gap-1 overflow-hidden max-xl:w-full max-xl:min-w-0 max-xl:flex-none max-xl:flex-col max-xl:overflow-visible">
          <AgentConfigurePreviewSurface className="min-w-105 flex-1 max-xl:h-100 max-xl:w-full max-xl:min-w-0 max-xl:flex-none">
            <AgentBuildPanelBackground visible={rightPanelChatMode === 'build'} />
            <AgentPreviewHeader
              mode={rightPanelChatMode}
              previewEnabled={previewEnabled}
              buildEnabled={capabilities.canBuild}
              chatFeatures={
                capabilities.canEdit
                  ? {
                      open: showChatFeatures,
                      onToggle: () => setShowChatFeatures((open) => !open),
                    }
                  : undefined
              }
              onModeChange={changeRightPanelMode}
              onOpenWorkingDirectory={() => {
                setShowPreviewVersions(false)
                setShowWorkingDirectory(true)
              }}
              onRefresh={restartCurrentChat}
              refreshDisabled={isRestartCurrentChatDisabled}
              showWorkingDirectoryAction={capabilities.canBuild && showWorkingDirectoryAction}
            />
            <AgentConfigurePreviewBody>
              {!(rightPanelMode === 'build'
                ? capabilities.canBuild
                : previewEnabled) ? null : buildDraft.isPending ? (
                <LoadingPlaceholder className="h-full" />
              ) : (
                <AgentConfigureRightPanelChat
                  agentId={agentId}
                  answerActionPosition="below"
                  agentName={agentQuery.data?.name}
                  agentSoulConfig={buildDraft.agentSoulConfig}
                  clearChatList={clearChatByMode[rightPanelChatMode]}
                  controllerRef={rightPanelChatControllerRef}
                  conversationIds={conversationIds}
                  disabled={isEnteringBuildMode}
                  mode={rightPanelChatMode}
                  speechToTextDraftType={
                    rightPanelChatMode === 'build' && buildDraft.isActive ? 'debug_build' : 'draft'
                  }
                  onClearChatListChange={(clearChatList) => {
                    setClearChatByMode((current) => ({
                      ...current,
                      [rightPanelChatMode]: clearChatList,
                    }))
                  }}
                  onConversationComplete={handleConversationComplete}
                  onConversationIdChange={handleConversationIdChange}
                  onBeforeSpeechToText={
                    rightPanelChatMode === 'build' ? saveDraftBeforeBuildRun : saveDraft
                  }
                  onSaveDraftBeforeRun={saveDraftBeforeChatRun}
                  onSendInterrupted={handleSendInterrupted}
                />
              )}
            </AgentConfigurePreviewBody>
          </AgentConfigurePreviewSurface>
          {capabilities.canReleaseAndVersion && showPreviewVersions && (
            <AgentPreviewVersionsPanel
              agentId={agentId}
              activeVersionId={activeVersionId}
              onSelectVersion={selectVersion}
              restoreDisabled={
                buildDraft.isActive ||
                buildDraftActionsDisabled ||
                isEnteringBuildMode ||
                isPublishing
              }
              onBeforeRestore={async () => {
                if (!isViewingVersion) {
                  await waitForPendingPreviewDraftSave()
                  await saveDraft()
                }
              }}
              onVersionRestored={async () => {
                await composerQuery.refetch()
                onComposerRebase()
              }}
              onClose={() => setShowPreviewVersions(false)}
            />
          )}
        </div>
      </section>
      {capabilities.canBuild && workingDirectoryCallerId && (
        <AgentWorkingDirectoryPanel
          source={{
            type: 'agent',
            agentId,
            callerType: rightPanelChatMode === 'build' ? 'build_draft' : 'conversation',
            callerId: workingDirectoryCallerId,
          }}
          open={showWorkingDirectory}
          onOpenChange={setShowWorkingDirectory}
        />
      )}
      <AgentChatFeaturesPanel
        show={capabilities.canEdit && showChatFeatures}
        appFeatures={buildDraft.agentSoulConfig?.app_features}
        disabled={isChatFeaturesReadOnly}
        onClose={() => setShowChatFeatures(false)}
      />
      <AgentConfigureClearSessionConfirmDialog
        open={capabilities.canBuild && showSwitchToPreviewConfirm}
        title={t(($) => $['agentDetail.configure.switchToPreviewConfirm.title'])}
        onOpenChange={setShowSwitchToPreviewConfirm}
        onConfirm={confirmSwitchToPreview}
      />
    </>
  )
}
