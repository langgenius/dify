import type { Action } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { FORM_ACTION_IDS } from '../interactions/action-payload'

export const DifyBuilderActionBar = ({
  actionValidity,
  actions,
  busy,
  formActionId,
  formId,
  pendingActionId,
  recheckReady,
  onAction,
}: {
  actionValidity: Record<string, boolean>
  actions: Action[]
  busy: boolean
  formActionId?: string
  formId?: string
  pendingActionId: string | null
  recheckReady: boolean
  onAction: (action: Action) => void
}) => {
  const visibleActions = actions.filter((action) => action.kind !== 'automatic')
  if (visibleActions.length === 0) return null

  return (
    <div className="flex flex-col items-end gap-1 px-4 py-2">
      {visibleActions.map((action) => {
        const loading = pendingActionId === action.id
        const awaitingChecklist = action.id === 'recheck' && !recheckReady
        const submitsForm = action.id === formActionId && formId !== undefined
        const invalid = FORM_ACTION_IDS.has(action.id)
          ? actionValidity[action.id] !== true
          : actionValidity[action.id] === false
        return (
          <Button
            key={action.id}
            size="small"
            variant={action.kind === 'primary' ? 'primary' : 'secondary'}
            tone={action.kind === 'destructive' ? 'destructive' : 'default'}
            type={submitsForm ? 'submit' : 'button'}
            form={submitsForm ? formId : undefined}
            loading={loading}
            disabled={
              loading
                ? false
                : busy || pendingActionId !== null || awaitingChecklist || (!submitsForm && invalid)
            }
            onClick={submitsForm ? undefined : () => onAction(action)}
          >
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}
