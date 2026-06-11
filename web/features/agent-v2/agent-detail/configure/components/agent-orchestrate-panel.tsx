'use client'

import type { AgentConfigSnapshotDetailResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { AgentAdvancedSettings } from './advanced-settings'
import { AgentConfigurePublishBar } from './agent-configure-publish-bar'
import { AgentFiles } from './agent-files'
import { AgentKnowledgeRetrieval } from './agent-knowledge-retrieval'
import { AgentModelField } from './agent-model-field'
import { AgentOrchestrateHeader } from './agent-orchestrate-header'
import { AgentPromptEditor } from './agent-prompt-editor/index'
import { AgentSkills } from './agent-skills'
import { AgentTools } from './agent-tools'

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
  const orchestrateHeadingId = 'agent-configure-orchestrate-heading'

  return (
    <div className="flex max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg">
      <AgentOrchestrateHeader headingId={orchestrateHeadingId} />

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
