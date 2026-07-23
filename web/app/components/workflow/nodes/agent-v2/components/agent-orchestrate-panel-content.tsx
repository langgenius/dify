'use client'

import type {
  AgentAppDetailWithSite,
  AgentConfigSnapshotSummaryResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  AgentComposerBindingResponse,
  WorkflowAgentComposerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { AgentPreviewChatController } from '@/features/agent-v2/agent-detail/configure/components/preview/chat-conversation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtom, useAtomValue, useStore as useJotaiStore, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { IS_CE_EDITION } from '@/config'
import {
  agentSoulConfigToFormState,
  formStateToAgentSoulConfig,
} from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import {
  agentComposerDraftAtom,
  rebaseAgentComposerDraftAtom,
} from '@/features/agent-v2/agent-composer/store'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { AgentConfigureClearSessionConfirmDialog } from '@/features/agent-v2/agent-detail/configure/components/confirm-clear-session-dialog'
import { AgentOrchestratePanel } from '@/features/agent-v2/agent-detail/configure/components/orchestrate'
import { AgentBuildDraftBar } from '@/features/agent-v2/agent-detail/configure/components/orchestrate/build-draft-bar'
import { AgentBuildPanelBackground } from '@/features/agent-v2/agent-detail/configure/components/preview/build-background'
import { AgentPreviewHeader } from '@/features/agent-v2/agent-detail/configure/components/preview/header'
import {
  invalidateAgentWorkingDirectoryFiles,
  useAgentWorkingDirectoryPanel,
} from '@/features/agent-v2/agent-detail/configure/components/preview/hook/use-working-directory-panel'
import { AgentConfigureRightPanelChat } from '@/features/agent-v2/agent-detail/configure/components/preview/right-panel-chat'
import {
  AgentConfigurePreviewSurface,
  AgentConfigureWorkspace,
} from '@/features/agent-v2/agent-detail/configure/components/workspace'
import {
  agentConfigureConversationIdsAtom,
  agentConfigureRightPanelModeAtom,
  agentConfigureSoulSourceOverrideAtom,
  resetAgentConfigureConversationAtom,
  setAgentConfigureConversationIdAtom,
  workflowInlineAgentConfigureScopedAtoms,
} from '@/features/agent-v2/agent-detail/configure/state'
import {
  useAgentConfigureBuildDraftActions,
  useAgentConfigureBuildDraftData,
} from '@/features/agent-v2/agent-detail/configure/use-agent-configure-build-draft'
import { useAgentConfigureSessionController } from '@/features/agent-v2/agent-detail/configure/use-agent-configure-session-controller'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { LicenseStatus } from '@/features/system-features/constants'
import { consoleQuery } from '@/service/client'
import { FlowType } from '@/types/common'
import { useWorkflowInlineAgentConfigureSync } from '../agent-soul-config'

type WorkflowRosterAgentOrchestratePanelContentProps = {
  agentId?: string
  nodeId: string
  open: boolean
}

type WorkflowInlineAgentConfigureWorkspaceProps = {
  agentId?: string
  flowId?: string
  flowType?: FlowType
  inlineComposerState?: WorkflowAgentComposerResponse
  nodeId: string
  onClose?: () => void
  onSaved?: (binding: AgentComposerBindingResponse) => void
  onSaveInlineToRoster?: () => void
  open: boolean
}

export function WorkflowRosterAgentOrchestratePanelContent(
  props: WorkflowRosterAgentOrchestratePanelContentProps,
) {
  const { agentId, nodeId, open } = props
  const rosterComposerQuery = useQuery(
    consoleQuery.agent.byAgentId.composer.get.queryOptions({
      input:
        open && agentId
          ? {
              params: {
                agent_id: agentId,
              },
            }
          : skipToken,
    }),
  )
  const composerState = rosterComposerQuery.data
  const agentSoulConfig = composerState?.agent_soul
  const activeConfigSnapshot =
    'active_config_snapshot' in (composerState ?? {})
      ? (composerState?.active_config_snapshot as
          | AgentConfigSnapshotSummaryResponse
          | null
          | undefined)
      : undefined

  if (!agentId || !agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  const initialAgentSoulConfig = agentSoulConfig as AgentSoulConfig
  const composerSessionKey = `${agentId ?? nodeId}:${activeConfigSnapshot?.id ?? 'draft'}`

  return (
    <AgentComposerProvider
      key={composerSessionKey}
      initialDraft={agentSoulConfigToFormState(initialAgentSoulConfig)}
      initialOriginalConfig={initialAgentSoulConfig}
    >
      <WorkflowRosterAgentOrchestratePanelContentInner
        activeConfigSnapshot={activeConfigSnapshot}
        agentId={agentId}
        agentSoulConfig={initialAgentSoulConfig}
        composerState={composerState}
      />
    </AgentComposerProvider>
  )
}

function WorkflowRosterAgentOrchestratePanelContentInner({
  activeConfigSnapshot,
  agentId,
  agentSoulConfig,
  composerState,
}: {
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentId: string
  agentSoulConfig: AgentSoulConfig
  composerState?: {
    agent?: {
      name?: string | null
    } | null
  }
}) {
  const { currentModel, setConfigureModel, textGenerationModelList } =
    useAgentOrchestrateModelOptions()

  return (
    <AgentOrchestratePanel
      agentId={agentId}
      activeConfigSnapshot={activeConfigSnapshot}
      agentSoulConfig={agentSoulConfig}
      agentName={composerState?.agent?.name}
      currentModel={currentModel}
      textGenerationModelList={textGenerationModelList}
      readOnly
      showHeader={false}
      showPublishBar={false}
      className="h-full max-w-none min-w-0 flex-none rounded-none border-0"
      onSelectModel={setConfigureModel}
      onPublish={() => undefined}
      onOpenVersions={() => undefined}
    />
  )
}

export function WorkflowInlineAgentConfigureWorkspace(
  props: WorkflowInlineAgentConfigureWorkspaceProps,
) {
  const { agentId, inlineComposerState, nodeId } = props
  const composerState = inlineComposerState
  const agentSoulConfig = composerState?.agent_soul as AgentSoulConfig | undefined
  const activeConfigSnapshot =
    'active_config_snapshot' in (composerState ?? {})
      ? (composerState?.active_config_snapshot as
          | AgentConfigSnapshotSummaryResponse
          | null
          | undefined)
      : undefined

  if (!agentId || !agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  const composerSessionKey = `${nodeId}:${agentId}`

  return (
    <ScopeProvider
      key={composerSessionKey}
      atoms={workflowInlineAgentConfigureScopedAtoms}
      name="WorkflowInlineAgentConfigure"
    >
      <WorkflowInlineAgentConfigureWorkspaceComposerScope
        {...props}
        activeConfigSnapshot={activeConfigSnapshot}
        agentId={agentId}
        agentSoulConfig={agentSoulConfig}
      />
    </ScopeProvider>
  )
}

function WorkflowInlineAgentConfigureWorkspaceComposerScope({
  agentId,
  agentSoulConfig,
  activeConfigSnapshot,
  ...props
}: Omit<WorkflowInlineAgentConfigureWorkspaceProps, 'agentId'> & {
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentId: string
  agentSoulConfig: AgentSoulConfig
}) {
  const soulSourceOverride = useAtomValue(agentConfigureSoulSourceOverrideAtom)
  const rightPanelMode = useAtomValue(agentConfigureRightPanelModeAtom)
  const setSoulSourceOverride = useSetAtom(agentConfigureSoulSourceOverrideAtom)
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    activeVersionId: activeConfigSnapshot?.id,
    composerAgentSoulConfig: agentSoulConfig,
    isBuildMode: rightPanelMode === 'build',
    isViewingVersion: false,
    normalAgentSoulConfig: agentSoulConfig,
    setSoulSourceOverride,
    soulSourceOverride,
  })
  const composerSessionKey = `${props.nodeId}:${agentId}`

  if (buildDraft.isPending) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <ScopeProvider
      atoms={[
        [
          agentConfigureConversationIdsAtom,
          {
            build: props.inlineComposerState?.debug_conversation_id ?? null,
            preview: null,
          },
        ],
      ]}
      name="WorkflowInlineAgentConfigureConversation"
    >
      <AgentComposerProvider
        key={composerSessionKey}
        initialDraft={agentSoulConfigToFormState(buildDraft.agentSoulConfig)}
        initialOriginalConfig={buildDraft.agentSoulConfig}
      >
        <WorkflowInlineAgentConfigureWorkspaceContent
          {...props}
          activeConfigSnapshot={activeConfigSnapshot}
          agentId={agentId}
          agentSoulConfig={agentSoulConfig}
          buildDraft={buildDraft}
        />
      </AgentComposerProvider>
    </ScopeProvider>
  )
}

function WorkflowInlineAgentConfigureWorkspaceContent({
  activeConfigSnapshot,
  agentId,
  agentSoulConfig,
  buildDraft,
  flowId,
  flowType,
  inlineComposerState,
  nodeId,
  onClose,
  onSaved,
  onSaveInlineToRoster,
  open,
}: Omit<WorkflowInlineAgentConfigureWorkspaceProps, 'agentId'> & {
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentId: string
  agentSoulConfig: AgentSoulConfig
  buildDraft: ReturnType<typeof useAgentConfigureBuildDraftData>
}) {
  const { t } = useTranslation('common')
  const { t: tAgent } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const jotaiStore = useJotaiStore()
  const setBuildDraftSoulSourceOverride = buildDraft.setSoulSourceOverride
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())
  const composerState = inlineComposerState
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [completedBuildConversationId, setCompletedBuildConversationId] = useState<string | null>(
    null,
  )
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null)
  const rightPanelChatControllerRef = useRef<AgentPreviewChatController>(null)
  const appId = flowType === FlowType.appFlow ? flowId : undefined
  const conversationIds = useAtomValue(agentConfigureConversationIdsAtom)
  const [rightPanelMode, setRightPanelMode] = useAtom(agentConfigureRightPanelModeAtom)
  const previewEnabled =
    !IS_CE_EDITION ||
    systemFeatures?.license.status === LicenseStatus.ACTIVE ||
    systemFeatures?.license.status === LicenseStatus.EXPIRING
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel({
    agentId,
    appId,
    conversationId: conversationIds[rightPanelMode],
    nodeId,
    workflowRunId,
  })
  const resetConversation = useSetAtom(resetAgentConfigureConversationAtom)
  const setConversationId = useSetAtom(setAgentConfigureConversationIdAtom)
  const rebaseComposerDraft = useSetAtom(rebaseAgentComposerDraftAtom)
  const { currentModel, setConfigureModel, textGenerationModelList } =
    useAgentOrchestrateModelOptions()
  const [isApplyingInlineBuildDraft, setIsApplyingInlineBuildDraft] = useState(false)
  const { draftSavedAt, saveAgentSoulConfig, saveDraft } = useWorkflowInlineAgentConfigureSync({
    nodeId,
    baseConfig: agentSoulConfig,
    currentModel,
    onDraftSaved: (composerState) => {
      const binding = composerState.binding
      if (
        binding?.binding_type !== 'inline_agent' ||
        !binding.agent_id ||
        !binding.current_snapshot_id
      ) {
        return
      }

      onSaved?.(binding)
    },
    enabled: open && !!agentSoulConfig && !buildDraft.isActive,
  })
  const refreshDebugConversationMutation = useMutation(
    consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions({
      onSuccess: ({
        debug_conversation_has_messages,
        debug_conversation_id,
        debug_conversation_message_count,
      }) => {
        queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
          consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
          (agentDetail) => {
            if (!agentDetail) return agentDetail

            return {
              ...agentDetail,
              debug_conversation_has_messages,
              debug_conversation_id,
              debug_conversation_message_count,
            }
          },
        )
        if (!flowId) return

        if (flowType === FlowType.snippet) {
          queryClient.setQueryData<WorkflowAgentComposerResponse | undefined>(
            consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
              {
                input: {
                  params: {
                    snippet_id: flowId,
                    node_id: nodeId,
                  },
                },
              },
            ),
            (composerState) =>
              composerState
                ? {
                    ...composerState,
                    debug_conversation_has_messages,
                    debug_conversation_id,
                    debug_conversation_message_count,
                  }
                : composerState,
          )
          return
        }

        if (flowType === FlowType.appFlow) {
          queryClient.setQueryData<WorkflowAgentComposerResponse | undefined>(
            consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
              input: {
                params: {
                  app_id: flowId,
                  node_id: nodeId,
                },
              },
            }),
            (composerState) =>
              composerState
                ? {
                    ...composerState,
                    debug_conversation_has_messages,
                    debug_conversation_id,
                    debug_conversation_message_count,
                  }
                : composerState,
          )
        }
      },
    }),
  )
  const {
    mutateAsync: refreshDebugConversationRequestAsync,
    isPending: isRefreshingBuildConversation,
  } = refreshDebugConversationMutation
  const { mutate: refreshPreviewConversationRequest, isPending: isRefreshingPreviewConversation } =
    useMutation(consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions())
  const refreshDebugConversationInput = useCallback(
    () => ({
      params: {
        agent_id: agentId,
      },
    }),
    [agentId],
  )
  const refreshDebugConversationAsync = useCallback(() => {
    return refreshDebugConversationRequestAsync(refreshDebugConversationInput())
  }, [refreshDebugConversationInput, refreshDebugConversationRequestAsync])
  const refreshPreviewConversationInput = useCallback(
    () => ({
      params: {
        agent_id: agentId,
      },
      body: {
        draft_type: 'draft' as const,
      },
    }),
    [agentId],
  )
  const refreshPreviewConversation = useCallback(() => {
    refreshPreviewConversationRequest(refreshPreviewConversationInput())
  }, [refreshPreviewConversationInput, refreshPreviewConversationRequest])
  const resetBuildChatState = useCallback(async () => {
    await refreshDebugConversationAsync().catch(() => undefined)
    setCompletedBuildConversationId(null)
    setConversationId({ mode: 'build', conversationId: null })
    setWorkflowRunId(null)
    setClearPreviewChat(true)
  }, [refreshDebugConversationAsync, setClearPreviewChat, setConversationId, setWorkflowRunId])
  const rebaseComposerDraftFromSoulConfig = useCallback(
    (agentSoulConfig?: AgentSoulConfig) => {
      rebaseComposerDraft({
        draft: agentSoulConfigToFormState(agentSoulConfig),
        originalConfig: agentSoulConfig,
      })
    },
    [rebaseComposerDraft],
  )
  const sessionController = useAgentConfigureSessionController({
    buildDraftAgentSoulConfig: buildDraft.buildDraftAgentSoulConfig,
    hasActiveBuildDraft: buildDraft.hasActiveBuildDraft,
    isBuildDraftActive: buildDraft.isActive,
    mode: rightPanelMode,
    normalAgentSoulConfig: agentSoulConfig,
    onModeChange: setRightPanelMode,
  })
  const {
    buildCallbackGeneration,
    buildDraftActionsDisabled,
    changeMode,
    confirmSwitchToPreview: confirmSessionSwitchToPreview,
    finishBuildAction,
    isBuildCallbackCurrent,
    resetBuildSession: resetSessionController,
    runBuildPreparation,
    setShowSwitchToPreviewConfirm,
    showSwitchToPreviewConfirm,
    waitForPendingPreviewDraftSave,
  } = sessionController
  const resetBuildSession = useCallback(
    () => resetSessionController(resetBuildChatState),
    [resetBuildChatState, resetSessionController],
  )
  const buildDraftActions = useAgentConfigureBuildDraftActions({
    agentId,
    buildDraftAgentSoulConfig: buildDraft.agentSoulConfig,
    isActive: buildDraft.isActive,
    normalAgentSoulConfig: agentSoulConfig,
    rebaseComposerDraft: rebaseComposerDraftFromSoulConfig,
    refetchBuildDraft: buildDraft.refetch,
    refetchComposer: async () => ({
      data: {
        agent_soul: agentSoulConfig,
      },
    }),
    resetBuildChatSession: resetBuildSession,
    saveDraft: async () => {
      await waitForPendingPreviewDraftSave()
      await saveDraft()
    },
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const { cancelBuildDraftRefresh } = buildDraftActions
  const buildDraftQueryOptions = consoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  })
  const { mutateAsync: saveBuildDraft } = useMutation(
    consoleQuery.agent.byAgentId.buildDraft.put.mutationOptions(),
  )
  const { mutateAsync: discardBuildDraft, isPending: isDiscardingBuildDraft } = useMutation(
    consoleQuery.agent.byAgentId.buildDraft.delete.mutationOptions(),
  )
  const getInlineAgentSoulDraft = useCallback(
    () =>
      formStateToAgentSoulConfig({
        baseConfig: agentSoulConfig,
        formState: jotaiStore.get(agentComposerDraftAtom),
        currentModel,
      }),
    [agentSoulConfig, currentModel, jotaiStore],
  )
  const prepareInlineBuildDraftBeforeRun = useCallback(async () => {
    await waitForPendingPreviewDraftSave()
    cancelBuildDraftRefresh()
    const configSnapshot = getInlineAgentSoulDraft()
    const savedComposerState = await saveDraft()
    const preparedAgentSoulConfig = savedComposerState?.agent_soul ?? configSnapshot
    const buildDraftState = await saveBuildDraft({
      params: {
        agent_id: agentId,
      },
      body: {
        variant: 'agent_app',
        save_strategy: 'save_to_current_version',
        agent_soul: preparedAgentSoulConfig,
      },
    })
    const savedBuildAgentSoulConfig = buildDraftState.agent_soul ?? preparedAgentSoulConfig
    queryClient.setQueryData(buildDraftQueryOptions.queryKey, buildDraftState)
    rebaseComposerDraftFromSoulConfig(savedBuildAgentSoulConfig)
    setBuildDraftSoulSourceOverride('build-draft')
    return savedBuildAgentSoulConfig
  }, [
    agentId,
    buildDraftQueryOptions.queryKey,
    cancelBuildDraftRefresh,
    getInlineAgentSoulDraft,
    queryClient,
    rebaseComposerDraftFromSoulConfig,
    saveBuildDraft,
    saveDraft,
    setBuildDraftSoulSourceOverride,
    waitForPendingPreviewDraftSave,
  ])
  const applyInlineBuildDraft = async () => {
    cancelBuildDraftRefresh()
    setIsApplyingInlineBuildDraft(true)
    try {
      if (!buildDraft.agentSoulConfig) return

      const savedComposerState = await saveAgentSoulConfig(buildDraft.agentSoulConfig)
      await discardBuildDraft({
        params: {
          agent_id: agentId,
        },
      }).catch(() => undefined)
      await resetBuildSession().catch(() => undefined)
      setBuildDraftSoulSourceOverride('draft')
      queryClient.removeQueries({
        queryKey: buildDraftQueryOptions.queryKey,
      })
      rebaseComposerDraftFromSoulConfig(
        savedComposerState?.agent_soul ?? buildDraft.agentSoulConfig,
      )
      toast.success(t(($) => $['api.actionSuccess']))
    } catch {
      toast.error(t(($) => $['api.actionFailed']))
    } finally {
      setIsApplyingInlineBuildDraft(false)
    }
  }
  const discardInlineBuildDraft = useCallback(async () => {
    cancelBuildDraftRefresh()
    try {
      await discardBuildDraft({
        params: {
          agent_id: agentId,
        },
      })
      await resetBuildSession().catch(() => undefined)
      setBuildDraftSoulSourceOverride('draft')
      queryClient.removeQueries({
        queryKey: buildDraftQueryOptions.queryKey,
      })
      rebaseComposerDraftFromSoulConfig(agentSoulConfig)
      toast.success(t(($) => $['api.actionSuccess']))
      return true
    } catch {
      toast.error(t(($) => $['api.actionFailed']))
      return false
    }
  }, [
    agentId,
    agentSoulConfig,
    buildDraftQueryOptions.queryKey,
    cancelBuildDraftRefresh,
    discardBuildDraft,
    queryClient,
    rebaseComposerDraftFromSoulConfig,
    resetBuildSession,
    setBuildDraftSoulSourceOverride,
    t,
  ])
  const stopBuildChat = useCallback(() => {
    rightPanelChatControllerRef.current?.stop()
  }, [])
  const changeRightPanelMode = useCallback(
    (nextMode: typeof rightPanelMode) =>
      changeMode(nextMode, {
        discardBuildDraft: discardInlineBuildDraft,
        rebaseComposerDraft: rebaseComposerDraftFromSoulConfig,
        savePreviewDraft: saveDraft,
        stopBuildChat,
      }),
    [
      changeMode,
      discardInlineBuildDraft,
      rebaseComposerDraftFromSoulConfig,
      saveDraft,
      stopBuildChat,
    ],
  )
  const confirmSwitchToPreview = useCallback(
    () => confirmSessionSwitchToPreview(discardInlineBuildDraft, stopBuildChat),
    [confirmSessionSwitchToPreview, discardInlineBuildDraft, stopBuildChat],
  )
  const hasRestartCurrentChatTarget =
    rightPanelMode === 'build'
      ? (inlineComposerState?.debug_conversation_has_messages ?? false) || buildDraft.isActive
      : !!conversationIds.preview
  const isRestartCurrentChatDisabled =
    !hasRestartCurrentChatTarget ||
    buildDraftActionsDisabled ||
    isApplyingInlineBuildDraft ||
    isDiscardingBuildDraft ||
    isRefreshingBuildConversation ||
    isRefreshingPreviewConversation
  const buildConversationHasAgentResponse =
    !!conversationIds.build &&
    (conversationIds.build === completedBuildConversationId ||
      (conversationIds.build === inlineComposerState?.debug_conversation_id &&
        (inlineComposerState?.debug_conversation_has_messages ?? false)))
  const showWorkingDirectoryAction = rightPanelMode === 'build' && buildConversationHasAgentResponse
  const restartCurrentChat = () => {
    if (isRestartCurrentChatDisabled) return

    if (rightPanelMode === 'build' && buildDraft.isActive) {
      void discardInlineBuildDraft()
      return
    }

    if (rightPanelMode === 'build') void refreshDebugConversationAsync().catch(() => undefined)
    else refreshPreviewConversation()
    resetConversation(rightPanelMode)
    setClearPreviewChat(true)
  }

  return (
    <AgentConfigureWorkspace
      className="rounded-[inherit]"
      leftPanel={
        <AgentOrchestratePanel
          agentId={agentId}
          appId={appId}
          nodeId={nodeId}
          activeConfigSnapshot={activeConfigSnapshot}
          agentSoulConfig={buildDraft.agentSoulConfig}
          agentName={composerState?.agent?.name}
          currentModel={currentModel}
          textGenerationModelList={textGenerationModelList}
          draftSavedAt={draftSavedAt}
          readOnly={buildDraft.isActive}
          isBuildDraftActive={buildDraft.isActive}
          buildDraftChangedKeys={buildDraft.changedKeys}
          showPublishBar={false}
          bottomAction={
            buildDraft.isActive ? (
              <AgentBuildDraftBar
                changesCount={buildDraft.changesCount}
                disabled={buildDraftActionsDisabled}
                isApplying={isApplyingInlineBuildDraft}
                isDiscarding={isDiscardingBuildDraft}
                onApply={() => {
                  void applyInlineBuildDraft()
                }}
                onDiscard={() => {
                  void discardInlineBuildDraft()
                }}
              />
            ) : undefined
          }
          headerAction={
            onSaveInlineToRoster ? (
              <WorkflowInlineAgentConfigureMoreAction onSaveInlineToRoster={onSaveInlineToRoster} />
            ) : undefined
          }
          className="min-w-90"
          onSelectModel={setConfigureModel}
          onPublish={() => {
            void saveDraft()
          }}
          onOpenVersions={() => undefined}
        />
      }
      rightPanel={
        <AgentConfigurePreviewSurface
          background={<AgentBuildPanelBackground visible={rightPanelMode === 'build'} />}
          header={
            <AgentPreviewHeader
              mode={rightPanelMode}
              previewEnabled={previewEnabled}
              isChatFeaturesOpen={false}
              onModeChange={changeRightPanelMode}
              onToggleChatFeatures={() => undefined}
              onOpenWorkingDirectory={workingDirectoryPanel.openWorkingDirectory}
              onRefresh={restartCurrentChat}
              refreshDisabled={isRestartCurrentChatDisabled}
              showWorkingDirectoryAction={showWorkingDirectoryAction}
              showChatFeaturesAction={false}
              trailingAction={
                <button
                  type="button"
                  onClick={onClose}
                  className="flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  aria-label={t(($) => $['operation.close'])}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </button>
              }
            />
          }
          chat={
            <AgentConfigureRightPanelChat
              agentId={agentId}
              answerActionPosition="below"
              agentIcon={composerState?.agent?.icon}
              agentIconBackground={composerState?.agent?.icon_background}
              agentIconType={
                composerState?.agent?.icon_type as Parameters<
                  typeof AgentConfigureRightPanelChat
                >[0]['agentIconType']
              }
              agentName={composerState?.agent?.name}
              agentSoulConfig={buildDraft.agentSoulConfig}
              clearChatList={clearPreviewChat}
              controllerRef={rightPanelChatControllerRef}
              conversationIds={conversationIds}
              mode={rightPanelMode}
              onClearChatListChange={setClearPreviewChat}
              onConversationComplete={(mode, completedConversationId, completedWorkflowRunId) => {
                if (mode !== 'build' || !isBuildCallbackCurrent(buildCallbackGeneration)) return

                setCompletedBuildConversationId(completedConversationId)
                setWorkflowRunId(completedWorkflowRunId ?? completedConversationId)
                invalidateAgentWorkingDirectoryFiles({
                  agentId,
                  appId,
                  conversationId: completedConversationId,
                  nodeId,
                  queryClient,
                  workflowRunId: completedWorkflowRunId ?? completedConversationId,
                })
                buildDraftActions.refreshBuildDraftAfterBuildChat(() =>
                  finishBuildAction(buildCallbackGeneration),
                )
              }}
              onConversationIdChange={(mode, conversationId) => {
                if (mode === 'build' && !isBuildCallbackCurrent(buildCallbackGeneration)) return
                setConversationId({ mode, conversationId })
              }}
              onWorkflowRunIdChange={(nextWorkflowRunId) => {
                if (!isBuildCallbackCurrent(buildCallbackGeneration)) return
                if (nextWorkflowRunId) setWorkflowRunId(nextWorkflowRunId)
              }}
              onSaveDraftBeforeRun={
                rightPanelMode === 'build'
                  ? () => {
                      setWorkflowRunId(null)
                      return runBuildPreparation({
                        generation: buildCallbackGeneration,
                        markBuildChatStarted: true,
                        prepare: prepareInlineBuildDraftBeforeRun,
                      })
                    }
                  : async () => {
                      await saveDraft()
                    }
              }
              onSendInterrupted={() => {
                finishBuildAction(buildCallbackGeneration)
              }}
            />
          }
        />
      }
      sidePanels={
        <>
          {workingDirectoryPanel.panel}
          <AgentConfigureClearSessionConfirmDialog
            open={showSwitchToPreviewConfirm}
            title={tAgent(($) => $['agentDetail.configure.switchToPreviewConfirm.title'])}
            onOpenChange={setShowSwitchToPreviewConfirm}
            onConfirm={confirmSwitchToPreview}
          />
        </>
      }
    />
  )
}

function WorkflowInlineAgentConfigureMoreAction({
  onSaveInlineToRoster,
}: {
  onSaveInlineToRoster: () => void
}) {
  const { t } = useTranslation('common')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            aria-label={t(($) => $['operation.more'])}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </button>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-44 w-max">
        <DropdownMenuItem className="gap-2 whitespace-nowrap" onClick={onSaveInlineToRoster}>
          <span
            aria-hidden
            className="i-ri-inbox-archive-line size-4 shrink-0 text-text-tertiary"
          />
          <span>{t(($) => $['roster.saveToRoster'], { ns: 'agentV2' })}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function useAgentOrchestrateModelOptions() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  const { data: defaultTextGenerationModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const defaultModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const currentModel = model ?? defaultModel
  const { textGenerationModelList } =
    useTextGenerationCurrentProviderAndModelAndModelList(currentModel)

  return {
    currentModel,
    setConfigureModel: setModel,
    textGenerationModelList,
  }
}
