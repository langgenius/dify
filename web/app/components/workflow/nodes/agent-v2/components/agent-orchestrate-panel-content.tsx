'use client'

import type { AgentConfigSnapshotSummaryResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentComposerBindingResponse, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { AgentOrchestratePanel } from '@/features/agent-v2/agent-detail/configure/components/orchestrate'
import { AgentBuildPanelBackground } from '@/features/agent-v2/agent-detail/configure/components/preview/build-background'
import { AgentBuildChat } from '@/features/agent-v2/agent-detail/configure/components/preview/build-chat'
import { AgentPreviewHeader } from '@/features/agent-v2/agent-detail/configure/components/preview/header'
import { useAgentWorkingDirectoryPanel } from '@/features/agent-v2/agent-detail/configure/components/preview/use-working-directory-panel'
import { AgentConfigurePreviewSurface, AgentConfigureWorkspace } from '@/features/agent-v2/agent-detail/configure/components/workspace'
import { useAgentPreviewSoulConfig } from '@/features/agent-v2/agent-detail/configure/hooks'
import { usePrepareAgentBuildDraftBeforeRun } from '@/features/agent-v2/agent-detail/configure/use-agent-build-draft-run'
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
  const activeVersionSnapshot = ('active_config_snapshot' in (composerState ?? {}))
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
  const composerSessionKey = `${agentId ?? nodeId}:${activeVersionSnapshot?.id ?? 'draft'}`

  return (
    <AgentComposerProvider
      key={composerSessionKey}
      initialDraft={agentSoulConfigToFormState(initialAgentSoulConfig)}
      initialOriginalConfig={initialAgentSoulConfig}
    >
      <WorkflowRosterAgentOrchestratePanelContentInner
        activeVersionSnapshot={activeVersionSnapshot}
        agentId={agentId}
        agentSoulConfig={initialAgentSoulConfig}
        composerState={composerState}
      />
    </AgentComposerProvider>
  )
}

function WorkflowRosterAgentOrchestratePanelContentInner({
  activeVersionSnapshot,
  agentId,
  agentSoulConfig,
  composerState,
}: {
  activeVersionSnapshot?: AgentConfigSnapshotSummaryResponse | null
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
      activeVersionSnapshot={activeVersionSnapshot}
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
  const activeVersionSnapshot = ('active_config_snapshot' in (composerState ?? {}))
    ? composerState?.active_config_snapshot as AgentConfigSnapshotSummaryResponse | null | undefined
    : undefined

  if (!agentId || !agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  const composerSessionKey = `${nodeId}:${agentId}:${activeVersionSnapshot?.id ?? 'draft'}`

  return (
    <AgentComposerProvider
      key={composerSessionKey}
      initialDraft={agentSoulConfigToFormState(agentSoulConfig)}
      initialOriginalConfig={agentSoulConfig}
    >
      <WorkflowInlineAgentConfigureWorkspaceContent
        {...props}
        activeVersionSnapshot={activeVersionSnapshot}
        agentId={agentId}
        agentSoulConfig={agentSoulConfig}
      />
    </AgentComposerProvider>
  )
}

function WorkflowInlineAgentConfigureWorkspaceContent({
  activeVersionSnapshot,
  agentId,
  agentSoulConfig,
  appId,
  inlineComposerState,
  nodeId,
  onClose,
  onSaved,
  onSaveInlineToRoster,
  open,
}: Omit<WorkflowInlineAgentConfigureWorkspaceProps, 'agentId'> & {
  activeVersionSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentId: string
  agentSoulConfig: AgentSoulConfig
}) {
  const { t } = useTranslation()
  const [clearChatList, setClearChatList] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const workingDirectoryPanel = useAgentWorkingDirectoryPanel()
  const composerState = inlineComposerState
  const { currentModel, setConfigureModel, textGenerationModelList } = useAgentOrchestrateModelOptions()
  const { draftSavedAt, saveDraft } = useWorkflowInlineAgentConfigureSync({
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
    enabled: open && !!agentSoulConfig,
  })
  const buildDraftRun = usePrepareAgentBuildDraftBeforeRun({
    agentId,
    isBuildDraftActive: false,
    saveDraft,
  })
  const previewAgentSoulConfig = useAgentPreviewSoulConfig(agentSoulConfig as AgentSoulConfig | undefined)

  return (
    <AgentConfigureWorkspace
      className="rounded-[inherit]"
      leftPanel={(
        <AgentOrchestratePanel
          agentId={agentId}
          appId={appId}
          nodeId={nodeId}
          activeVersionSnapshot={activeVersionSnapshot}
          agentSoulConfig={agentSoulConfig}
          agentName={composerState?.agent?.name}
          currentModel={currentModel}
          textGenerationModelList={textGenerationModelList}
          draftSavedAt={draftSavedAt}
          showPublishBar={false}
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
              onRefresh={() => {
                setConversationId(null)
                setClearChatList(true)
              }}
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
            <AgentBuildChat
              agentId={agentId}
              agentIcon={composerState?.agent?.icon}
              agentIconBackground={composerState?.agent?.icon_background}
              agentIconType={composerState?.agent?.icon_type as Parameters<typeof AgentBuildChat>[0]['agentIconType']}
              agentName={composerState?.agent?.name}
              agentSoulConfig={previewAgentSoulConfig}
              clearChatList={clearChatList}
              conversationId={conversationId}
              draftType="debug_build"
              onClearChatListChange={setClearChatList}
              onConversationIdChange={setConversationId}
              onSaveDraftBeforeRun={buildDraftRun.prepareBuildDraftBeforeRun}
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
