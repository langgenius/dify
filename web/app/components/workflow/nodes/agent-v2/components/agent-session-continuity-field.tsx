import type { AgentSessionContinuitySave } from '@/app/components/workflow/store/workflow/workflow-draft-slice'
import { Button } from '@langgenius/dify-ui/button'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import {
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks/use-workflow-history'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'

type AgentSessionContinuityFieldProps = {
  nodeId: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

export function AgentSessionContinuityField({
  nodeId,
  checked,
  disabled,
  onChange,
}: AgentSessionContinuityFieldProps) {
  const { t } = useTranslation(['workflowAgent', 'workflow', 'common'])
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const workflowStore = useWorkflowStore()
  const save = useStore((state) => state.agentSessionContinuitySaves.get(nodeId))
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { saveStateToHistory } = useWorkflowHistory()
  const failedSave = save?.phase === 'failed' && save.requested === checked ? save : undefined
  const displayedChecked = failedSave?.confirmed ?? checked

  const handleCheckedChange = async (requested: boolean) => {
    const { agentSessionContinuitySaves, setAgentSessionContinuitySave } = workflowStore.getState()
    if (
      disabled ||
      getNodesReadOnly() ||
      agentSessionContinuitySaves.get(nodeId)?.phase === 'saving'
    )
      return

    const pending: AgentSessionContinuitySave = {
      phase: 'saving',
      requested,
      confirmed: displayedChecked,
    }
    setAgentSessionContinuitySave(nodeId, pending)
    onChange(requested)

    let saved: boolean
    try {
      const result = handleNodeDataUpdateWithSyncDraft(
        { id: nodeId, data: { continue_agent_session: requested } },
        { sync: true },
      )
      if (checked !== requested) saveStateToHistory(WorkflowHistoryEvent.NodeChange)
      saved = Boolean(await result)
    } catch {
      saved = false
    }

    // Another draft save may already have persisted this edit while the panel was closed.
    if (workflowStore.getState().agentSessionContinuitySaves.get(nodeId) === pending)
      setAgentSessionContinuitySave(nodeId, saved ? undefined : { ...pending, phase: 'failed' })
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span id={titleId} className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['nodes.agent.sessionContinuity.title'], { ns: 'workflowAgent' })}
        </span>
        <Switch
          aria-labelledby={titleId}
          aria-describedby={failedSave ? `${descriptionId} ${errorId}` : descriptionId}
          checked={displayedChecked}
          disabled={disabled || nodesReadOnly}
          loading={save?.phase === 'saving'}
          onCheckedChange={handleCheckedChange}
        />
      </div>
      <p id={descriptionId} className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['nodes.agent.sessionContinuity.description'], { ns: 'workflowAgent' })}
      </p>
      {failedSave && (
        <div className="mt-1 flex items-center justify-between gap-2" role="alert">
          <span id={errorId} className="system-xs-regular text-text-destructive">
            {t(($) => $['common.draftSaveFailed'], { ns: 'workflow' })}
          </span>
          <Button
            type="button"
            variant="ghost-accent"
            size="small"
            disabled={disabled || nodesReadOnly}
            onClick={() => void handleCheckedChange(failedSave.requested)}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
    </div>
  )
}
