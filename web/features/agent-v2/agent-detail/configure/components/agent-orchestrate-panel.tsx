'use client'

import type { AgentConfigSnapshotDetailResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { AgentAdvancedSettings } from './advanced-settings'
import { AgentConfigurePublishBar } from './agent-configure-publish-bar'
import { AgentFiles } from './agent-files'
import { AgentKnowledgeRetrieval } from './agent-knowledge-retrieval'
import { AgentPromptEditor } from './agent-prompt-editor'
import { AgentSkills } from './agent-skills'
import { AgentTools } from './agent-tools'

type AgentModelFieldProps = {
  currentModel?: DefaultModel
  textGenerationModelList: Model[]
  onSelect: (model: DefaultModel) => void
}

function AgentModelField({
  currentModel,
  textGenerationModelList,
  onSelect,
}: AgentModelFieldProps) {
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

type AgentOrchestratePanelProps = {
  agentId: string
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  currentModel?: DefaultModel
  textGenerationModelList: Model[]
  onSelectModel: (model: DefaultModel) => void
  onOpenVersions: () => void
}

export function AgentOrchestratePanel({
  agentId,
  agentSoulConfig,
  currentModel,
  textGenerationModelList,
  onSelectModel,
  onOpenVersions,
}: AgentOrchestratePanelProps) {
  const { t } = useTranslation('agentV2')
  const orchestrateHeadingId = 'agent-configure-orchestrate-heading'

  return (
    <div className="flex max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg">
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
          onSelect={onSelectModel}
        />
        <AgentPromptEditor />
        <AgentSkills agentId={agentId} />
        <AgentFiles />
        <AgentTools />
        <AgentKnowledgeRetrieval />
        <AgentAdvancedSettings />
      </ScrollArea>

      <AgentConfigurePublishBar
        agentId={agentId}
        agentSoulConfig={agentSoulConfig}
        currentModel={currentModel}
        onOpenVersions={onOpenVersions}
      />
    </div>
  )
}
