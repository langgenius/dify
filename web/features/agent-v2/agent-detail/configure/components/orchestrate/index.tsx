'use client'

import type { AgentConfigSnapshotDetailResponse, AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentOrchestrateAddActionsProvider } from './add-actions'
import { AgentAdvancedSettings } from './advanced'
import { AgentOrchestrateBottomActions } from './bottom-actions'
import { AgentConfigApiContextProvider } from './config-context'
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
  appId?: string
  nodeId?: string
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  agentName?: string | null
  currentModel?: AgentComposerModel
  textGenerationModelList: Model[]
  draftSavedAt?: number
  isPublishing?: boolean
  className?: string
  readOnly?: boolean
  selectedVersionSnapshot?: AgentConfigSnapshotSummaryResponse | null
  isBuildDraftActive?: boolean
  showHeader?: boolean
  showPublishBar?: boolean
  headerAction?: ReactNode
  bottomAction?: ReactNode
  onSelectModel: (model: AgentComposerModel) => void
  onPublish?: () => void | Promise<void>
  onExitVersions?: () => void
  onOpenVersions?: () => void
}

export function AgentOrchestratePanel({
  agentId,
  appId,
  nodeId,
  activeConfigIsPublished,
  activeConfigSnapshot,
  agentSoulConfig: _agentSoulConfig,
  agentName,
  currentModel,
  textGenerationModelList,
  draftSavedAt,
  isPublishing,
  className,
  readOnly = false,
  selectedVersionSnapshot,
  isBuildDraftActive = false,
  showHeader = true,
  showPublishBar = true,
  headerAction,
  bottomAction,
  onSelectModel,
  onPublish,
  onExitVersions,
  onOpenVersions,
}: AgentOrchestratePanelProps) {
  const { t } = useTranslation('agentV2')
  const orchestrateHeadingId = 'agent-configure-orchestrate-heading'
  const orchestrateLabel = t('agentDetail.configure.title')
  const orchestrateBottomAction = bottomAction ?? (showPublishBar
    ? (
        <AgentConfigurePublishBar
          agentId={agentId}
          activeConfigIsPublished={activeConfigIsPublished}
          activeConfigSnapshot={activeConfigSnapshot}
          agentName={agentName}
          draftSavedAt={draftSavedAt}
          isPublishing={isPublishing}
          selectedVersionSnapshot={selectedVersionSnapshot}
          onPublish={onPublish}
          onExitVersions={onExitVersions}
          onOpenVersions={onOpenVersions}
        />
      )
    : null)
  const hasBottomAction = !!orchestrateBottomAction
  const draftType = isBuildDraftActive ? ('debug_build' as const) : ('draft' as const)
  const configApiContext = useMemo(() => appId && nodeId
    ? {
        agentId,
        draftType,
        versionId: selectedVersionSnapshot?.id ?? undefined,
        workflow: {
          appId,
          nodeId,
        },
      }
    : {
        agentId,
        draftType,
        versionId: selectedVersionSnapshot?.id ?? undefined,
      }, [agentId, appId, draftType, nodeId, selectedVersionSnapshot?.id])

  return (
    <div className={cn('relative flex max-w-140 min-w-90 flex-[0_0_min(41.08280255%,560px)] flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg', className)}>
      {showHeader && <AgentOrchestrateHeader headingId={orchestrateHeadingId} trailingAction={headerAction} isBuildDraftActive={isBuildDraftActive} />}

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
              content: cn('min-h-full px-4 py-3', hasBottomAction && 'pb-20'),
              scrollbar: hasBottomAction ? 'z-20' : undefined,
            }}
          >
            <AgentConfigApiContextProvider value={configApiContext}>
              <AgentOrchestrateAddActionsProvider>
                <AgentModelField
                  currentModel={currentModel}
                  textGenerationModelList={textGenerationModelList}
                  onSelect={onSelectModel}
                />
                <AgentPromptEditor />
                <AgentSkills />
                <AgentFiles />
                <AgentTools />
                <AgentKnowledgeRetrieval />
                <AgentAdvancedSettings />
              </AgentOrchestrateAddActionsProvider>
            </AgentConfigApiContextProvider>
          </ScrollArea>
        </div>
      </AgentOrchestrateReadOnlyContext>

      {orchestrateBottomAction
        ? (
            <AgentOrchestrateBottomActions>
              {orchestrateBottomAction}
            </AgentOrchestrateBottomActions>
          )
        : null}
    </div>
  )
}
