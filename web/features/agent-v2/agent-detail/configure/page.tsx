'use client'

import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/client'
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

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [selectedModel, setSelectedModel] = useState<DefaultModel>()
  const [prompt, setPrompt] = useState('')
  const [showPreviewVersions, setShowPreviewVersions] = useState(false)
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const agentQuery = useQuery(consoleQuery.agents.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const {
    data: defaultTextGenerationModel,
  } = useDefaultModel(ModelTypeEnum.textGeneration)
  const currentModel = selectedModel ?? (defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined)
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
          <div className="shrink-0">
            <ModelSelector
              defaultModel={currentModel}
              modelList={textGenerationModelList}
              triggerClassName="h-8! max-w-48 rounded-lg!"
              popupClassName="w-[432px] max-w-[min(432px,calc(100vw-32px))]"
              showModelMeta={false}
              onSelect={setSelectedModel}
            />
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
          {/* Prompt editor */}
          <AgentPromptEditor value={prompt} onChange={setPrompt} />

          {/* Skills */}
          <AgentSkills />

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
        <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-divider-subtle px-4">
          <div className="h-8 w-36 rounded-xl bg-components-panel-on-panel-item-bg shadow-md shadow-shadow-shadow-5" />
          <div className="h-8 w-20 rounded-lg bg-components-button-primary-bg shadow-xs shadow-shadow-shadow-3" />
        </div>
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
              agentId={agentId}
              appId={agentQuery.data?.app_id}
              activeVersionId={agentQuery.data?.active_config_snapshot_id}
              currentModel={currentModel}
              prompt={prompt}
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
