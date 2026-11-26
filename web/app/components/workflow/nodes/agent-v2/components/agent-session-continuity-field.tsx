import type { AgentV2NodeType } from '../types'
import type { NodeProps } from '@/app/components/workflow/types'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import {
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks/use-workflow-history'

export function AgentSessionContinuityField({ id, data }: NodeProps<AgentV2NodeType>) {
  const { t } = useTranslation(['workflowAgent'])
  const titleId = useId()
  const descriptionId = useId()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { saveStateToHistory } = useWorkflowHistory()

  const handleCheckedChange = (checked: boolean) => {
    if (nodesReadOnly) return

    handleNodeDataUpdateWithSyncDraft({ id, data: { continue_agent_session: checked } })
    saveStateToHistory(WorkflowHistoryEvent.NodeChange)
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span id={titleId} className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['nodes.agent.sessionContinuity.title'], { ns: 'workflowAgent' })}
        </span>
        <Switch
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          checked={data.continue_agent_session ?? true}
          disabled={nodesReadOnly}
          onCheckedChange={handleCheckedChange}
        />
      </div>
      <p id={descriptionId} className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['nodes.agent.sessionContinuity.description'], { ns: 'workflowAgent' })}
      </p>
    </div>
  )
}
