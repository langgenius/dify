'use client'

import type { AgentAppDetailWithSite, AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { useAgentConfigureData } from '../hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { rebaseAgentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/client'
import { useAgentConfigureModelOptions } from '../hooks'
import {
  agentConfigureBuildDraftActionsDisabledAtom,
  agentConfigureClearPreviewChatAtom,
  agentConfigureConversationIdsAtom,
  agentConfigureRightPanelChatModeAtom,
  agentConfigureRightPanelModeAtom,
  agentConfigureShowChatFeaturesAtom,
  agentConfigureShowPreviewVersionsAtom,
  agentConfigureSoulSourceOverrideAtom,
  resetAgentConfigureConversationAtom,
  setAgentConfigureConversationIdAtom,
} from '../state'
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
  const soulSourceOverride = useAtomValue(agentConfigureSoulSourceOverrideAtom)
  const setSoulSourceOverride = useSetAtom(agentConfigureSoulSourceOverrideAtom)
  const isViewingVersion = !!selectedVersionId
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    activeVersionId,
    composerAgentSoulConfig: composerQuery.data?.agent_soul,
    isViewingVersion,
    normalAgentSoulConfig: agentSoulConfig,
    setSoulSourceOverride,
    soulSourceOverride,
  })

  if (buildDraft.isPending) {
    return (
      <AgentConfigurePageLoading label={t('agentDetail.sections.configure')} />
    )
  }

  const composerSessionKey = `${agentId}:${activeVersionId ?? selectedVersionId ?? 'draft'}:${composerRebaseRevision}`

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
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
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
  const refreshDebugConversationInput = useCallback(() => ({
    params: {
      agent_id: agentId,
    },
  }), [agentId])
  const refreshDebugConversation = useCallback(() => {
    refreshDebugConversationRequest(refreshDebugConversationInput())
  }, [refreshDebugConversationInput, refreshDebugConversationRequest])
  const refreshDebugConversationAsync = useCallback(() => {
    return refreshDebugConversationRequestAsync(refreshDebugConversationInput())
  }, [refreshDebugConversationInput, refreshDebugConversationRequestAsync])

  return (
    <ScopeProvider
      atoms={[
        [agentConfigureConversationIdsAtom, {
          build: agentQuery.data?.debug_conversation_id ?? null,
          preview: null,
        }],
      ]}
      name="AgentConfigureConversation"
    >
      <AgentComposerProvider
        key={composerSessionKey}
        initialDraft={agentSoulConfigToFormState(buildDraft.agentSoulConfig)}
        initialOriginalConfig={buildDraft.agentSoulConfig}
      >
        <AgentConfigurePageComposerContent
          agentId={agentId}
          agentIconType={agentIconType}
          buildDraft={buildDraft}
          configureData={configureData}
          isRefreshingDebugConversation={isRefreshingDebugConversation}
          isViewingVersion={isViewingVersion}
          workingDirectoryPanel={workingDirectoryPanel}
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
  agentIconType,
  buildDraft,
  configureData,
  isRefreshingDebugConversation,
  isViewingVersion,
  workingDirectoryPanel,
  onComposerRebase,
  onRefreshDebugConversation,
  onRefreshDebugConversationAsync,
  onSelectVersion,
}: {
  agentId: string
  agentIconType: AgentIconType | null | undefined
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
  configureData: ReturnType<typeof useAgentConfigureData>
  isRefreshingDebugConversation: boolean
  isViewingVersion: boolean
  workingDirectoryPanel: ReturnType<typeof useAgentWorkingDirectoryPanel>
  onComposerRebase: () => void
  onRefreshDebugConversation: () => void
  onRefreshDebugConversationAsync: () => Promise<unknown>
  onSelectVersion: (versionId: string | null) => void
}) {
  const {
    agentQuery,
    composerQuery,
    versionQuery,
    selectedVersionId,
    activeVersionId,
    activeConfigSnapshot,
    agentSoulConfig,
  } = configureData
  const buildDraftActionsDisabled = useAtomValue(agentConfigureBuildDraftActionsDisabledAtom)
  const clearPreviewChat = useAtomValue(agentConfigureClearPreviewChatAtom)
  const conversationIds = useAtomValue(agentConfigureConversationIdsAtom)
  const rightPanelChatMode = useAtomValue(agentConfigureRightPanelChatModeAtom)
  const showChatFeatures = useAtomValue(agentConfigureShowChatFeaturesAtom)
  const showPreviewVersions = useAtomValue(agentConfigureShowPreviewVersionsAtom)
  const resetConversation = useSetAtom(resetAgentConfigureConversationAtom)
  const setBuildDraftActionsDisabled = useSetAtom(agentConfigureBuildDraftActionsDisabledAtom)
  const setClearPreviewChat = useSetAtom(agentConfigureClearPreviewChatAtom)
  const setConversationId = useSetAtom(setAgentConfigureConversationIdAtom)
  const setRightPanelMode = useSetAtom(agentConfigureRightPanelModeAtom)
  const setShowChatFeatures = useSetAtom(agentConfigureShowChatFeaturesAtom)
  const setShowPreviewVersions = useSetAtom(agentConfigureShowPreviewVersionsAtom)
  const rebaseComposerDraft = useSetAtom(rebaseAgentComposerDraftAtom)
  const showBuildDraftBar = buildDraft.isActive
  const resetBuildChatSession = useCallback(async () => {
    try {
      await onRefreshDebugConversationAsync()
    }
    finally {
      setConversationId({ mode: 'build', conversationId: null })
      setClearPreviewChat(true)
    }
  }, [onRefreshDebugConversationAsync, setClearPreviewChat, setConversationId])
  const rebaseComposerDraftFromSoulConfig = useCallback((agentSoulConfig?: AgentSoulConfig) => {
    rebaseComposerDraft({
      draft: agentSoulConfigToFormState(agentSoulConfig),
      originalConfig: agentSoulConfig,
    })
  }, [rebaseComposerDraft])
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
    normalAgentSoulConfig: agentSoulConfig,
    rebaseComposerDraft: rebaseComposerDraftFromSoulConfig,
    refetchBuildDraft: buildDraft.refetch,
    refetchComposer: composerQuery.refetch,
    resetBuildChatSession,
    saveDraft,
    onComposerRebased: onComposerRebase,
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const selectVersion = useCallback((versionId: string | null) => {
    onSelectVersion(versionId)
  }, [onSelectVersion])
  const hasRestartCurrentChatTarget = !!conversationIds[rightPanelChatMode] || (rightPanelChatMode === 'build' && buildDraft.isActive)
  const isRestartCurrentChatDisabled = !hasRestartCurrentChatTarget
    || buildDraftActionsDisabled
    || isRefreshingDebugConversation
    || buildDraftActions.isApplyingBuildDraft
    || buildDraftActions.isDiscardingBuildDraft
  const restartCurrentChat = () => {
    if (isRestartCurrentChatDisabled)
      return

    if (rightPanelChatMode === 'build' && buildDraft.isActive) {
      void buildDraftActions.discardBuildDraft()
      return
    }

    if (rightPanelChatMode === 'build')
      onRefreshDebugConversation()

    resetConversation(rightPanelChatMode)
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
              refreshDisabled={isRestartCurrentChatDisabled}
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
                  buildDraftActions.refreshBuildDraftAfterBuildChat(() => setBuildDraftActionsDisabled(false))
              }}
              onConversationIdChange={(mode, conversationId) => {
                setConversationId({ mode, conversationId })
              }}
              onSaveDraftBeforeRun={rightPanelChatMode === 'build'
                ? async () => {
                  setBuildDraftActionsDisabled(true)
                  try {
                    return await buildDraftActions.prepareBuildDraftBeforeRun()
                  }
                  catch (error) {
                    setBuildDraftActionsDisabled(false)
                    throw error
                  }
                }
                : saveDraft}
              onSendInterrupted={() => {
                if (rightPanelChatMode === 'build')
                  setBuildDraftActionsDisabled(false)
              }}
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
