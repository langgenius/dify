'use client'

import type { AgentConfigSnapshotDetailResponse, AgentConfigSnapshotSummaryResponse, AgentPublishedReferenceResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigurePublishPayload } from './publish-bar'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { AgentOrchestrateAddActionsProvider } from './add-actions'
import { AgentAdvancedSettings } from './advanced'
import { AgentFiles } from './files'
import { AgentOrchestrateHeader } from './header'
import { AgentKnowledgeRetrieval } from './knowledge'
import { AgentModelField } from './model-config/field'
import { AgentPromptEditor } from './prompt-editor'
import { AgentConfigurePublishBar } from './publish-bar'
import { AgentOrchestrateReadOnlyContext } from './read-only-context'
import { AgentSkills } from './skills'
import { AgentTools } from './tools'

type AgentOrchestratePanelProps = {
  agentId: string
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  agentName?: string | null
  currentModel?: DefaultModel
  textGenerationModelList: Model[]
  draftSavedAt?: number
  isPublishing?: boolean
  publishedReferenceCount?: number
  publishedReferences?: AgentPublishedReferenceResponse[]
  className?: string
  readOnly?: boolean
  showHeader?: boolean
  showPublishBar?: boolean
  onSelectModel: (model: DefaultModel) => void
  onPublish: (payload: AgentConfigurePublishPayload) => void | Promise<void>
  onOpenVersions: () => void
}

export function AgentOrchestratePanel({
  agentId,
  activeConfigSnapshot,
  agentSoulConfig,
  agentName,
  currentModel,
  textGenerationModelList,
  draftSavedAt,
  isPublishing,
  publishedReferenceCount,
  publishedReferences,
  className,
  readOnly = false,
  showHeader = true,
  showPublishBar = true,
  onSelectModel,
  onPublish,
  onOpenVersions,
}: AgentOrchestratePanelProps) {
  const { t } = useTranslation('agentV2')
  const orchestrateHeadingId = 'agent-configure-orchestrate-heading'
  const orchestrateLabel = t('agentDetail.configure.orchestrate')

  return (
    <div className={cn('flex max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg', className)}>
      {showHeader && <AgentOrchestrateHeader headingId={orchestrateHeadingId} />}

      <AgentOrchestrateReadOnlyContext value={readOnly}>
        <div
          aria-readonly={readOnly}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ScrollArea
            className="min-h-0 flex-1 overflow-hidden"
            label={showHeader ? undefined : orchestrateLabel}
            labelledBy={showHeader ? orchestrateHeadingId : undefined}
            slotClassNames={{
              viewport: 'overscroll-contain',
              content: 'min-h-full px-4 py-3',
            }}
          >
            <AgentOrchestrateAddActionsProvider>
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
            </AgentOrchestrateAddActionsProvider>
          </ScrollArea>
        </div>
      </AgentOrchestrateReadOnlyContext>

      {showPublishBar && (
        <AgentConfigurePublishBar
          agentId={agentId}
          activeConfigSnapshot={activeConfigSnapshot}
          agentSoulConfig={agentSoulConfig}
          agentName={agentName}
          currentModel={currentModel}
          draftSavedAt={draftSavedAt}
          isPublishing={isPublishing}
          publishedReferenceCount={publishedReferenceCount}
          publishedReferences={publishedReferences}
          onPublish={onPublish}
          onOpenVersions={onOpenVersions}
        />
      )}
    </div>
  )
}
