'use client'

import type { AgentConfigSnapshotSummaryResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentComposerBindingResponse, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { rebaseAgentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { AgentOrchestratePanel } from '@/features/agent-v2/agent-detail/configure/components/orchestrate'
import { AgentBuildDraftBar } from '@/features/agent-v2/agent-detail/configure/components/orchestrate/build-draft-bar'
import { AgentBuildPanelBackground } from '@/features/agent-v2/agent-detail/configure/components/preview/build-background'
import { AgentPreviewHeader } from '@/features/agent-v2/agent-detail/configure/components/preview/header'
import { AgentConfigureRightPanelChat } from '@/features/agent-v2/agent-detail/configure/components/preview/right-panel-chat'
import { useAgentWorkingDirectoryPanel } from '@/features/agent-v2/agent-detail/configure/components/preview/use-working-directory-panel'
import { AgentConfigurePreviewSurface, AgentConfigureWorkspace } from '@/features/agent-v2/agent-detail/configure/components/workspace'
import {
  agentConfigureBuildDraftActionsDisabledAtom,
  agentConfigureClearPreviewChatAtom,
  agentConfigureConversationIdsAtom,
  agentConfigureRightPanelChatModeAtom,
  agentConfigureScopedAtoms,
  agentConfigureSoulSourceOverrideAtom,
  resetAgentConfigureConversationAtom,
  setAgentConfigureConversationIdAtom,
} from '@/features/agent-v2/agent-detail/configure/state'
import { useAgentConfigureBuildDraftActions, useAgentConfigureBuildDraftData } from '@/features/agent-v2/agent-detail/configure/use-agent-configure-build-draft'
import { consoleQuery } from '@/service/client'
import { useWorkflowInlineAgentConfigureSync } from '../agent-soul-config'

type WorkflowRosterAgentOrchestratePanelContentProps = {
  agentId?: string
  nodeId: string
  open: boolean
}

type WorkflowInlineAgentConfigureWorkspaceProps = {
  agentId?: string
  appId?: string
  inlineComposerState?: WorkflowAgentComposerResponse
  nodeId: string
  onClose?: () => void
  onSaved?: (binding: AgentComposerBindingResponse) => void
  onSaveInlineToRoster?: () => void
  open: boolean
}

export function WorkflowRosterAgentOrchestratePanelContent(props: WorkflowRosterAgentOrchestratePanelContentProps) {
  const {
    agentId,
    nodeId,
    open,
  } = props
  const rosterComposerQuery = useQuery(consoleQuery.agent.byAgentId.composer.get.queryOptions({
    input: open && agentId
      ? {
          params: {
            agent_id: agentId,
          },
        }
      : skipToken,
  }))
  const composerState = rosterComposerQuery.data
  const agentSoulConfig = composerState?.agent_soul
  const activeConfigSnapshot = ('active_config_snapshot' in (composerState ?? {}))
    ? composerState?.active_config_snapshot as AgentConfigSnapshotSummaryResponse | null | undefined
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
  const { currentModel, setConfigureModel, textGenerationModelList } = useAgentOrchestrateModelOptions()

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

export function WorkflowInlineAgentConfigureWorkspace(props: WorkflowInlineAgentConfigureWorkspaceProps) {
  const {
    agentId,
    inlineComposerState,
    nodeId,
  } = props
  const composerState = inlineComposerState
  const agentSoulConfig = composerState?.agent_soul as AgentSoulConfig | undefined
  const activeConfigSnapshot = ('active_config_snapshot' in (composerState ?? {}))
    ? composerState?.active_config_snapshot as AgentConfigSnapshotSummaryResponse | null | undefined
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
    <ScopeProvider key={composerSessionKey} atoms={agentConfigureScopedAtoms} name="WorkflowInlineAgentConfigure">
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
  const setSoulSourceOverride = useSetAtom(agentConfigureSoulSourceOverrideAtom)
  const buildDraft = useAgentConfigureBuildDraftData({
    agentId,
    activeVersionId: activeConfigSnapshot?.id,
    composerAgentSoulConfig: agentSoulConfig,
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
  )
}

function WorkflowInlineAgentConfigureWorkspaceContent({
  activeConfigSnapshot,
  agentId,
  agentSoulConfig,
  appId,
  buildDraft,
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
  const { t } = useTranslation()
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
  const composerState = inlineComposerState
  const buildDraftActionsDisabled = useAtomValue(agentConfigureBuildDraftActionsDisabledAtom)
  const clearPreviewChat = useAtomValue(agentConfigureClearPreviewChatAtom)
  const conversationIds = useAtomValue(agentConfigureConversationIdsAtom)
  const rightPanelChatMode = useAtomValue(agentConfigureRightPanelChatModeAtom)
  const resetConversation = useSetAtom(resetAgentConfigureConversationAtom)
  const setBuildDraftActionsDisabled = useSetAtom(agentConfigureBuildDraftActionsDisabledAtom)
  const setClearPreviewChat = useSetAtom(agentConfigureClearPreviewChatAtom)
  const setConversationId = useSetAtom(setAgentConfigureConversationIdAtom)
  const rebaseComposerDraft = useSetAtom(rebaseAgentComposerDraftAtom)
  const { currentModel, setConfigureModel, textGenerationModelList } = useAgentOrchestrateModelOptions()
  const [isApplyingInlineBuildDraft, setIsApplyingInlineBuildDraft] = useState(false)
  const { draftSavedAt, saveAgentSoulConfig, saveDraft } = useWorkflowInlineAgentConfigureSync({
    nodeId,
    baseConfig: agentSoulConfig,
    currentModel,
    onDraftSaved: (composerState) => {
      const binding = composerState.binding
      if (
        binding?.binding_type !== 'inline_agent'
        || !binding.agent_id
        || !binding.current_snapshot_id
      ) {
        return
      }

      onSaved?.(binding)
    },
    enabled: open && !!agentSoulConfig && !buildDraft.isActive,
  })
  const resetBuildChatSession = useCallback(async () => {
    setConversationId({ mode: 'build', conversationId: null })
    setClearPreviewChat(true)
  }, [setClearPreviewChat, setConversationId])
  const rebaseComposerDraftFromSoulConfig = useCallback((agentSoulConfig?: AgentSoulConfig) => {
    rebaseComposerDraft({
      draft: agentSoulConfigToFormState(agentSoulConfig),
      originalConfig: agentSoulConfig,
    })
  }, [rebaseComposerDraft])
  const buildDraftActions = useAgentConfigureBuildDraftActions({
    agentId,
    isActive: buildDraft.isActive,
    normalAgentSoulConfig: agentSoulConfig,
    rebaseComposerDraft: rebaseComposerDraftFromSoulConfig,
    refetchBuildDraft: buildDraft.refetch,
    refetchComposer: async () => ({
      data: {
        agent_soul: agentSoulConfig,
      },
    }),
    resetBuildChatSession,
    saveDraft: async () => {
      await saveDraft()
    },
    setSoulSourceOverride: buildDraft.setSoulSourceOverride,
  })
  const buildDraftQueryOptions = consoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  })
  const discardBuildDraftMutation = useMutation(consoleQuery.agent.byAgentId.buildDraft.delete.mutationOptions())
  const applyInlineBuildDraft = async () => {
    setIsApplyingInlineBuildDraft(true)
    try {
      if (!buildDraft.agentSoulConfig)
        return

      const savedComposerState = await saveAgentSoulConfig(buildDraft.agentSoulConfig)
      await discardBuildDraftMutation.mutateAsync({
        params: {
          agent_id: agentId,
        },
      })
      await resetBuildChatSession().catch(() => undefined)
      buildDraft.setSoulSourceOverride('draft')
      queryClient.removeQueries({
        queryKey: buildDraftQueryOptions.queryKey,
      })
      rebaseComposerDraftFromSoulConfig(savedComposerState?.agent_soul ?? buildDraft.agentSoulConfig)
      toast.success(tCommon('api.actionSuccess'))
    }
    catch {
      toast.error(tCommon('api.actionFailed'))
    }
    finally {
      setIsApplyingInlineBuildDraft(false)
    }
  }
  const discardInlineBuildDraft = async () => {
    try {
      await discardBuildDraftMutation.mutateAsync({
        params: {
          agent_id: agentId,
        },
      })
      await resetBuildChatSession().catch(() => undefined)
      buildDraft.setSoulSourceOverride('draft')
      queryClient.removeQueries({
        queryKey: buildDraftQueryOptions.queryKey,
      })
      rebaseComposerDraftFromSoulConfig(agentSoulConfig)
      toast.success(tCommon('api.actionSuccess'))
    }
    catch {
      toast.error(tCommon('api.actionFailed'))
    }
  }
  const hasRestartCurrentChatTarget = !!conversationIds[rightPanelChatMode] || buildDraft.isActive
  const isRestartCurrentChatDisabled = !hasRestartCurrentChatTarget
    || buildDraftActionsDisabled
    || isApplyingInlineBuildDraft
    || discardBuildDraftMutation.isPending
  const restartCurrentChat = () => {
    if (isRestartCurrentChatDisabled)
      return

    if (buildDraft.isActive) {
      void discardInlineBuildDraft()
      return
    }

    resetConversation(rightPanelChatMode)
  }

  return (
    <AgentConfigureWorkspace
      className="rounded-[inherit]"
      leftPanel={(
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
          showPublishBar={false}
          bottomAction={buildDraft.isActive
            ? (
                <AgentBuildDraftBar
                  changesCount={buildDraft.changesCount}
                  disabled={buildDraftActionsDisabled}
                  isApplying={isApplyingInlineBuildDraft}
                  isDiscarding={discardBuildDraftMutation.isPending}
                  onApply={() => {
                    void applyInlineBuildDraft()
                  }}
                  onDiscard={() => {
                    void discardInlineBuildDraft()
                  }}
                />
              )
            : undefined}
          headerAction={onSaveInlineToRoster
            ? <WorkflowInlineAgentConfigureMoreAction onSaveInlineToRoster={onSaveInlineToRoster} />
            : undefined}
          className="min-w-90"
          onSelectModel={setConfigureModel}
          onPublish={() => {
            void saveDraft()
          }}
          onOpenVersions={() => undefined}
        />
      )}
      rightPanel={(
        <AgentConfigurePreviewSurface
          background={<AgentBuildPanelBackground visible />}
          header={(
            <AgentPreviewHeader
              mode="build"
              previewEnabled={false}
              isChatFeaturesOpen={false}
              onModeChange={() => undefined}
              onToggleChatFeatures={() => undefined}
              onOpenWorkingDirectory={workingDirectoryPanel.openWorkingDirectory}
              onRefresh={restartCurrentChat}
              refreshDisabled={isRestartCurrentChatDisabled}
              showChatFeaturesAction={false}
              trailingAction={(
                <button
                  type="button"
                  onClick={onClose}
                  className="flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  aria-label={t('operation.close', { ns: 'common' })}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </button>
              )}
            />
          )}
          chat={(
            <AgentConfigureRightPanelChat
              agentId={agentId}
              agentIcon={composerState?.agent?.icon}
              agentIconBackground={composerState?.agent?.icon_background}
              agentIconType={composerState?.agent?.icon_type as Parameters<typeof AgentConfigureRightPanelChat>[0]['agentIconType']}
              agentName={composerState?.agent?.name}
              agentSoulConfig={buildDraft.agentSoulConfig}
              clearChatList={clearPreviewChat}
              conversationIds={conversationIds}
              draftType="debug_build"
              mode={rightPanelChatMode}
              onClearChatListChange={setClearPreviewChat}
              onConversationComplete={(mode) => {
                if (mode === 'build')
                  buildDraftActions.refreshBuildDraftAfterBuildChat(() => setBuildDraftActionsDisabled(false))
              }}
              onConversationIdChange={(mode, conversationId) => {
                setConversationId({ mode, conversationId })
              }}
              onSaveDraftBeforeRun={async () => {
                setBuildDraftActionsDisabled(true)
                try {
                  await buildDraftActions.prepareBuildDraftBeforeRun()
                }
                catch (error) {
                  setBuildDraftActionsDisabled(false)
                  throw error
                }
              }}
            />
          )}
        />
      )}
      sidePanels={workingDirectoryPanel.panel}
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
        render={(
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            aria-label={t('operation.more')}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </button>
        )}
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-44 w-max">
        <DropdownMenuItem className="gap-2 whitespace-nowrap" onClick={onSaveInlineToRoster}>
          <span aria-hidden className="i-ri-inbox-archive-line size-4 shrink-0 text-text-tertiary" />
          <span>{t('roster.saveToRoster', { ns: 'agentV2' })}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function useAgentOrchestrateModelOptions() {
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
