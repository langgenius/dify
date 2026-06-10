'use client'

import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/client'
import { AgentPromptEditor } from './components/agent-prompt-editor'
import { AgentSkills } from './components/agent-skills'

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [selectedModel, setSelectedModel] = useState<DefaultModel>()
  const [prompt, setPrompt] = useState('')
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

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={agentQuery.isPending}
      className="flex h-full min-w-0 flex-1 gap-1 overflow-hidden bg-background-default p-1"
    >
      {/* Orchestrate configuration panel */}
      <div className="flex max-w-[560px] min-w-[360px] flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg">
        {/* Orchestrate header */}
        <div className="flex shrink-0 items-center gap-1 px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <h2 className="truncate title-xl-semi-bold text-text-primary">
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

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {/* Prompt editor */}
          <AgentPromptEditor value={prompt} onChange={setPrompt} />

          {/* Skills */}
          <AgentSkills />

          {/* Tools */}
          <div className="mb-4 space-y-2">
            <div className="h-4 w-18 rounded bg-state-base-hover" />
            <div className="space-y-1">
              <div className="h-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg" />
              <div className="h-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg" />
              <div className="h-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg" />
              <div className="h-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg" />
            </div>
          </div>

          {/* Knowledge retrieval */}
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-state-base-hover" />
            <div className="space-y-1">
              <div className="h-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg" />
              <div className="h-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg" />
            </div>
          </div>
        </div>

        {/* Save and publish actions */}
        <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-divider-subtle px-4">
          <div className="h-8 w-36 rounded-xl bg-components-panel-on-panel-item-bg shadow-md shadow-shadow-shadow-5" />
          <div className="h-8 w-20 rounded-lg bg-components-button-primary-bg shadow-xs shadow-shadow-shadow-3" />
        </div>
      </div>

      {/* Preview panel */}
      <div className="flex min-w-[420px] flex-1 flex-col overflow-hidden rounded-lg bg-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
        {/* Preview header */}
        <div className="flex h-14 shrink-0 items-center gap-3 px-6">
          <div className="h-5 w-18 rounded-md bg-state-base-hover" />
          <div className="ml-auto flex gap-2">
            <div className="size-8 rounded-lg bg-state-base-hover" />
            <div className="size-8 rounded-lg bg-state-base-hover" />
            <div className="size-8 rounded-lg bg-state-base-hover" />
          </div>
        </div>

        {/* Chat transcript */}
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="mx-auto flex max-w-[720px] flex-col gap-3">
            <div className="ml-auto h-12 w-48 rounded-2xl bg-background-default-dimmed" />
            <div className="h-16 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-1" />
            <div className="h-7 w-80 rounded-md bg-components-panel-on-panel-item-bg" />
            <div className="h-9 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-2" />
            <div className="h-9 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-2" />
            <div className="h-26 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-1" />
            <div className="h-8 w-32 rounded-lg bg-state-base-hover" />
          </div>
        </div>

        {/* Chat input */}
        <div className="shrink-0 bg-linear-to-b from-components-chat-input-bg-mask-1 to-components-chat-input-bg-mask-2 px-6 py-3">
          <div className="mx-auto h-12 max-w-[720px] rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5" />
        </div>
      </div>
    </section>
  )
}
