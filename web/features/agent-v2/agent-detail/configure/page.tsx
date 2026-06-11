'use client'

import type { AgentConfigSnapshotDetailResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Button } from '@langgenius/dify-ui/button'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/client'
import { isAgentConfigureDirtyAtom, useAgentConfigureCurrentModel, useAgentConfigureModel, useAgentConfigurePrompt, useHydrateAgentConfigureDraft } from './atoms'
import { AgentAdvancedSettings } from './components/advanced-settings'
import { AgentFiles } from './components/agent-files'
import { AgentKnowledgeRetrieval } from './components/agent-knowledge-retrieval'
import { AgentPreviewChat } from './components/agent-preview-chat'
import { AgentPreviewHeader } from './components/agent-preview-header'
import { AgentPreviewVersionsPanel } from './components/agent-preview-versions-panel'
import { AgentPromptEditor } from './components/agent-prompt-editor'
import { AgentSkills } from './components/agent-skills'
import { AgentTools } from './components/agent-tools'

type AgentConfigurePageProps = {
  agentId: string
}

function AgentModelField({
  currentModel,
  textGenerationModelList,
  onSelect,
}: {
  currentModel?: DefaultModel
  textGenerationModelList: Model[]
  onSelect: (model: DefaultModel) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <FieldRoot name="model" className="gap-1 pb-4">
      <FieldLabel className="py-0 system-sm-semibold-uppercase! text-text-secondary">
        {t('agentDetail.configure.model.label')}
      </FieldLabel>
      <div className="relative h-8 min-w-0">
        <ModelSelector
          defaultModel={currentModel}
          modelList={textGenerationModelList}
          triggerClassName="h-8! w-full rounded-lg! pr-10! [&_.i-ri-arrow-down-s-line]:hidden"
          popupClassName="w-(--anchor-width) max-w-[min(var(--anchor-width),var(--available-width),calc(100vw-32px))]"
          showModelMeta={false}
          onSelect={onSelect}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-lg bg-components-button-tertiary-bg">
          <span aria-hidden="true" className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
        </div>
      </div>
    </FieldRoot>
  )
}

function AgentConfigurePublishBar({
  agentId,
  agentSoulConfig,
  currentModel,
  onOpenVersions,
}: {
  agentId: string
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  currentModel?: {
    provider: string
    model: string
  }
  onOpenVersions: () => void
}) {
  const { t } = useTranslation('agentV2')
  const [prompt] = useAgentConfigurePrompt()
  const isDirty = useAtomValue(isAgentConfigureDirtyAtom)

  const handlePublish = () => {
    const publishPayload = {
      agent_id: agentId,
      config_snapshot: {
        ...agentSoulConfig,
        prompt: {
          ...agentSoulConfig?.prompt,
          system_prompt: prompt,
        },
        model: currentModel
          ? {
              ...agentSoulConfig?.model,
              model_provider: currentModel.provider,
              model: currentModel.model,
              plugin_id: agentSoulConfig?.model?.plugin_id ?? '',
            }
          : agentSoulConfig?.model,
      },
    }

    // eslint-disable-next-line no-console -- Requested temporary publish payload inspection.
    console.log('[Agent Roster] publish payload', publishPayload)
  }

  return (
    <div className="flex h-14 shrink-0 items-center justify-end border-t border-divider-subtle px-4">
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-divider-subtle bg-components-panel-bg px-4 py-2 shadow-lg shadow-shadow-shadow-5">
        <div className="flex min-w-0 items-center gap-2 system-sm-regular text-text-tertiary">
          <span aria-hidden className="size-1.5 shrink-0 rounded-[2px] bg-text-tertiary" />
          <span className="shrink-0 text-text-secondary">{t('agentDetail.configure.publishBar.draft')}</span>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">
            {isDirty
              ? t('agentDetail.configure.publishBar.unsaved')
              : t('agentDetail.configure.publishBar.saved')}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('agentDetail.configure.publishBar.versionHistory')}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={onOpenVersions}
        >
          <span aria-hidden className="i-ri-history-line size-4" />
        </button>
        <Button
          type="button"
          variant="primary"
          className="h-8 gap-2 rounded-lg px-3"
          onClick={handlePublish}
        >
          <span>{t('agentDetail.publish')}</span>
          <span aria-hidden className="flex items-center gap-0.5">
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-components-button-primary-bg-hover system-2xs-medium text-text-primary-on-surface">⌘</span>
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-components-button-primary-bg-hover system-2xs-medium text-text-primary-on-surface">⇧</span>
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-components-button-primary-bg-hover system-2xs-medium text-text-primary-on-surface">P</span>
          </span>
        </Button>
      </div>
    </div>
  )
}

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [, setConfigureModel] = useAgentConfigureModel()
  const agentQuery = useQuery(consoleQuery.agents.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const activeVersionId = agentQuery.data?.active_config_snapshot_id
  const versionQuery = useQuery(consoleQuery.agents.byAgentId.versions.byVersionId.get.queryOptions({
    input: activeVersionId
      ? {
          params: {
            agent_id: agentId,
            version_id: activeVersionId,
          },
        }
      : skipToken,
  }))
  const agentSoulConfig = (versionQuery.data as AgentConfigSnapshotDetailResponse | undefined)?.config_snapshot
  useHydrateAgentConfigureDraft({
    agentId,
    activeVersionId,
    config: agentSoulConfig,
  })
  const {
    data: defaultTextGenerationModel,
  } = useDefaultModel(ModelTypeEnum.textGeneration)
  const defaultModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const currentModel = useAgentConfigureCurrentModel(defaultModel)
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList(currentModel)
  const orchestrateHeadingId = 'agent-configure-orchestrate-heading'

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={agentQuery.isPending}
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden p-1"
    >
      {/* Orchestrate configuration panel */}
      <div className="flex max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg">
        {/* Orchestrate header */}
        <div className="flex shrink-0 items-center gap-1 px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <h2 id={orchestrateHeadingId} className="truncate title-xl-semi-bold text-text-primary">
              {t('agentDetail.configure.orchestrate')}
            </h2>
          </div>
        </div>

        <ScrollArea
          className="min-h-0 flex-1 overflow-hidden"
          labelledBy={orchestrateHeadingId}
          slotClassNames={{
            viewport: 'overscroll-contain',
            content: 'min-h-full px-4 py-3',
          }}
        >
          <AgentModelField
            currentModel={currentModel}
            textGenerationModelList={textGenerationModelList}
            onSelect={setConfigureModel}
          />

          {/* Prompt editor */}
          <AgentPromptEditor />

          {/* Skills */}
          <AgentSkills agentId={agentId} />

          {/* Files */}
          <AgentFiles />

          {/* Tools */}
          <AgentTools />

          {/* Knowledge retrieval */}
          <AgentKnowledgeRetrieval />

          {/* Advanced settings */}
          <AgentAdvancedSettings />
        </ScrollArea>

        {/* Save and publish actions */}
        <AgentConfigurePublishBar
          agentId={agentId}
          agentSoulConfig={agentSoulConfig}
          currentModel={currentModel}
          onOpenVersions={() => setShowPreviewVersions(true)}
        />
      </div>

      {/* Preview area */}
      <div className="flex min-w-105 flex-1 gap-1 overflow-hidden">
        <div className="flex min-w-105 flex-1 flex-col overflow-hidden rounded-lg bg-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
          <AgentPreviewHeader
            isVersionsOpen={showPreviewVersions}
            onToggleVersions={() => setShowPreviewVersions(open => !open)}
            onRestart={() => setClearPreviewChat(true)}
          />

          <div className="min-h-0 flex-1">
            <AgentPreviewChat
              appId={agentQuery.data?.app_id}
              activeVersionId={activeVersionId}
              agentSoulConfig={agentSoulConfig}
              isConfigPending={versionQuery.isPending}
              clearChatList={clearPreviewChat}
              onClearChatListChange={setClearPreviewChat}
            />
          </div>
        </div>

        {showPreviewVersions && (
          <AgentPreviewVersionsPanel
            agentId={agentId}
            activeVersionId={agentQuery.data?.active_config_snapshot_id}
            onClose={() => setShowPreviewVersions(false)}
          />
        )}
      </div>
    </section>
  )
}
