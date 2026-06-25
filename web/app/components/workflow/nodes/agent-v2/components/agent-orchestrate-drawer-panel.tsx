'use client'

import type { AgentConfigSnapshotSummaryResponse, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useHydrateAgentSoulConfigDraft } from '@/features/agent-v2/agent-composer/store'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { AgentOrchestratePanel } from '@/features/agent-v2/agent-detail/configure/components/orchestrate'
import { AgentBuildPanelBackground } from '@/features/agent-v2/agent-detail/configure/components/preview/build-background'
import { AgentBuildChat } from '@/features/agent-v2/agent-detail/configure/components/preview/build-chat'
import { AgentPreviewHeader } from '@/features/agent-v2/agent-detail/configure/components/preview/header'
import { AgentConfigurePreviewSurface, AgentConfigureWorkspace } from '@/features/agent-v2/agent-detail/configure/components/workspace'
import { useAgentPreviewSoulConfig } from '@/features/agent-v2/agent-detail/configure/hooks'
import { consoleQuery } from '@/service/client'
import { useWorkflowInlineAgentConfigureSync } from '../agent-soul-config'

type AgentOrchestrateDrawerPanelProps = {
  agentId?: string
  appId?: string
  inlineComposerState?: WorkflowAgentComposerResponse
  isInline: boolean
  nodeId: string
  onClose?: () => void
  open: boolean
}

export function AgentOrchestrateDrawerPanel(props: AgentOrchestrateDrawerPanelProps) {
  return (
    <AgentComposerProvider>
      <AgentOrchestrateDrawerPanelContent {...props} />
    </AgentComposerProvider>
  )
}

export function WorkflowInlineAgentConfigureWorkspace(props: AgentOrchestrateDrawerPanelProps) {
  return (
    <AgentComposerProvider>
      <WorkflowInlineAgentConfigureWorkspaceContent {...props} />
    </AgentComposerProvider>
  )
}

function AgentOrchestrateDrawerPanelContent({
  agentId,
  appId,
  inlineComposerState,
  isInline,
  nodeId,
  open,
}: AgentOrchestrateDrawerPanelProps) {
  const rosterComposerQuery = useQuery(consoleQuery.agent.byAgentId.composer.get.queryOptions({
    input: open && !isInline && agentId
      ? {
          params: {
            agent_id: agentId,
          },
        }
      : skipToken,
  }))
  const composerState = isInline ? inlineComposerState : rosterComposerQuery.data
  const agentSoulConfig = composerState?.agent_soul
  const activeConfigSnapshot = ('active_config_snapshot' in (composerState ?? {}))
    ? composerState?.active_config_snapshot as AgentConfigSnapshotSummaryResponse | null | undefined
    : undefined
  const { currentModel, setConfigureModel, textGenerationModelList } = useAgentOrchestrateModelOptions()
  const { draftSavedAt, saveDraft } = useWorkflowInlineAgentConfigureSync({
    nodeId,
    baseConfig: agentSoulConfig,
    currentModel,
    enabled: open && isInline && !!agentSoulConfig,
  })

  useHydrateAgentSoulConfigDraft({
    agentId: isInline ? `${nodeId}:${agentId ?? 'pending'}` : agentId ?? nodeId,
    activeVersionId: activeConfigSnapshot?.id,
    config: agentSoulConfig as AgentSoulConfig | undefined,
  })

  if (!agentId || !agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <AgentOrchestratePanel
      agentId={agentId}
      appId={isInline ? appId : undefined}
      nodeId={isInline ? nodeId : undefined}
      activeConfigSnapshot={activeConfigSnapshot}
      agentSoulConfig={agentSoulConfig as AgentSoulConfig}
      agentName={composerState?.agent?.name}
      currentModel={currentModel}
      textGenerationModelList={textGenerationModelList}
      draftSavedAt={draftSavedAt}
      readOnly={!isInline}
      showHeader={false}
      showPublishBar={false}
      className="h-full max-w-none min-w-0 flex-none rounded-none border-0"
      onSelectModel={setConfigureModel}
      onPublish={() => {
        void saveDraft()
      }}
      onOpenVersions={() => undefined}
    />
  )
}

function WorkflowInlineAgentConfigureWorkspaceContent({
  agentId,
  appId,
  inlineComposerState,
  nodeId,
  onClose,
  open,
}: AgentOrchestrateDrawerPanelProps) {
  const [clearChatList, setClearChatList] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const composerState = inlineComposerState
  const agentSoulConfig = composerState?.agent_soul
  const activeConfigSnapshot = ('active_config_snapshot' in (composerState ?? {}))
    ? composerState?.active_config_snapshot as AgentConfigSnapshotSummaryResponse | null | undefined
    : undefined
  const { currentModel, setConfigureModel, textGenerationModelList } = useAgentOrchestrateModelOptions()
  const { draftSavedAt, saveDraft } = useWorkflowInlineAgentConfigureSync({
    nodeId,
    baseConfig: agentSoulConfig,
    currentModel,
    enabled: open && !!agentSoulConfig,
  })
  const previewAgentSoulConfig = useAgentPreviewSoulConfig(agentSoulConfig as AgentSoulConfig | undefined)

  useHydrateAgentSoulConfigDraft({
    agentId: `${nodeId}:${agentId ?? 'pending'}`,
    activeVersionId: activeConfigSnapshot?.id,
    config: agentSoulConfig as AgentSoulConfig | undefined,
  })

  if (!agentId || !agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <Loading type="app" />
      </div>
    )
  }

  const handleSave = async () => {
    if (isSaving)
      return

    setIsSaving(true)
    try {
      await saveDraft()
      onClose?.()
    }
    finally {
      setIsSaving(false)
    }
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
          agentSoulConfig={agentSoulConfig as AgentSoulConfig}
          agentName={composerState?.agent?.name}
          currentModel={currentModel}
          textGenerationModelList={textGenerationModelList}
          draftSavedAt={draftSavedAt}
          showPublishBar={false}
          bottomBar={(
            <WorkflowInlineAgentConfigureActionBar
              isSaving={isSaving}
              onCancel={() => onClose?.()}
              onSave={() => {
                void handleSave()
              }}
            />
          )}
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
              onOpenVersions={() => undefined}
              onRefresh={() => {
                setConversationId(null)
                setClearChatList(true)
              }}
              showChatFeaturesAction={false}
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
              onSaveDraftBeforeRun={saveDraft}
            />
          )}
        />
      )}
    />
  )
}

function WorkflowInlineAgentConfigureActionBar({
  isSaving,
  onCancel,
  onSave,
}: {
  isSaving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const { t } = useTranslation('common')

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-components-panel-bg pt-4 pb-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <Button
          type="button"
          variant="secondary"
          size="medium"
          className="min-w-18"
          disabled={isSaving}
          onClick={onCancel}
        >
          {t('operation.cancel')}
        </Button>
        <div className="flex h-4 items-start px-1">
          <div className="h-full w-px bg-divider-regular" />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="medium"
          className="px-2"
          disabled={isSaving}
          aria-label={t('operation.more')}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </Button>
        <Button
          type="button"
          variant="primary"
          size="medium"
          className="min-w-20"
          loading={isSaving}
          onClick={onSave}
        >
          {t('operation.save')}
        </Button>
      </div>
    </div>
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
