import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import {
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks/use-workflow-history'

type AgentSessionContinuityFieldProps = {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

export function AgentSessionContinuityField({
  checked,
  disabled,
  onChange,
}: AgentSessionContinuityFieldProps) {
  const { t } = useTranslation(['workflowAgent'])
  const titleId = useId()
  const descriptionId = useId()
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()

  const handleCheckedChange = (requested: boolean) => {
    if (disabled || getNodesReadOnly()) return

    onChange(requested)
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
          checked={checked}
          disabled={disabled || nodesReadOnly}
          onCheckedChange={handleCheckedChange}
        />
      </div>
      <p id={descriptionId} className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['nodes.agent.sessionContinuity.description'], { ns: 'workflowAgent' })}
      </p>
    </div>
  )
}
