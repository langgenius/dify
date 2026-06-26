'use client'

import type { AgentAppDetailWithSite, AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
      <AgentConfigurePageSkeleton label={t('agentDetail.sections.configure')} />
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
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<AgentConfigureRightPanelMode>('build')
  const [hideBuildDraftBarUntilRefresh, setHideBuildDraftBarUntilRefresh] = useState(false)
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
  const showBuildDraftBar = buildDraft.isActive && !hideBuildDraftBarUntilRefresh
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
  const restartCurrentChat = () => {
    if (rightPanelChatMode === 'build' && buildDraft.isActive) {
      void buildDraftActions.discardBuildDraft()
      return
    }

    if (rightPanelChatMode === 'build')
      refreshDebugConversation(conversationIds.build ?? '')

    setConversationIds(current => ({
      ...current,
      [rightPanelChatMode]: null,
    }))
    setClearPreviewChat(true)
  }

  if (buildDraft.isPending) {
    return (
      <AgentConfigurePageSkeleton label={t('agentDetail.sections.configure')} />
    )
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
          bottomBar={showBuildDraftBar
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
              onConversationComplete={(mode) => {
                if (mode === 'build')
                  buildDraftActions.refreshBuildDraftAfterBuildChat(() => setHideBuildDraftBarUntilRefresh(false))
              }}
              onConversationIdChange={updateConversationId}
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

function AgentConfigurePageSkeleton({
  label,
}: {
  label: string
}) {
  return (
    <section
      aria-label={label}
      aria-busy
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden bg-background-body p-1"
    >
      <div
        aria-hidden
        className="relative flex max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg"
      >
        <div className="h-[68px] shrink-0" />
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
          <div className="relative overflow-hidden">
            <div className="flex flex-col gap-4 py-1">
              {[
                { id: 'model', labelClassName: 'w-20', controlClassName: 'h-8' },
                { id: 'prompt', labelClassName: 'w-24', controlClassName: 'h-24' },
                { id: 'skills', labelClassName: 'w-16', controlClassName: 'h-8' },
                { id: 'files', labelClassName: 'w-18', controlClassName: 'h-8 opacity-60' },
              ].map(row => (
                <div
                  key={row.id}
                  className="flex flex-col gap-1 opacity-20"
                >
                  <div className={`h-3 animate-pulse rounded-xs bg-text-quaternary motion-reduce:animate-none ${row.labelClassName}`} />
                  <div className={`animate-pulse rounded-lg bg-components-input-bg-normal motion-reduce:animate-none ${row.controlClassName}`} />
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg" />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-[72px] flex-col items-center justify-end px-4 pt-4 pb-2">
          <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-components-panel-bg to-components-panel-bg-transparent [mask-image:linear-gradient(to_top,black,transparent)] backdrop-blur-[2px] [-webkit-mask-image:linear-gradient(to_top,black,transparent)]" />
          <div className="relative z-10 h-12 w-full max-w-[506px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]" />
        </div>
      </div>
      <div aria-hidden className="flex min-w-105 flex-1 gap-1 overflow-hidden">
        <div className="relative isolate flex min-w-105 flex-1 flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
          <div className="relative z-1 h-12 shrink-0" />
          <div className="relative z-1 min-h-0 flex-1" />
        </div>
      </div>
    </section>
  )
}
