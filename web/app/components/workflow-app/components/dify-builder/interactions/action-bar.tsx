import type { DifyBuilderActionResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import { Button } from '@langgenius/dify-ui/button'

export const DifyBuilderActionBar = ({
  actions,
  busy,
  pendingActionId,
  submitActionId,
  isExpanded,
  onAction,
}: {
  actions: DifyBuilderActionResponse[]
  busy: boolean
  pendingActionId: string | null
  submitActionId?: string
  isExpanded?: (actionId: string) => boolean | undefined
  onAction: (action: DifyBuilderActionResponse) => void
}) => {
  const visibleActions = actions.filter((action) => action.kind !== 'automatic')
  if (visibleActions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {visibleActions.map((action) => {
        const loading = pendingActionId === action.id
        return (
          <Button
            key={action.id}
            type={submitActionId === action.id ? 'submit' : 'button'}
            size="small"
            variant={action.kind === 'primary' ? 'primary' : 'secondary'}
            tone={action.kind === 'destructive' ? 'destructive' : 'default'}
            loading={loading}
            disabled={loading ? false : busy || pendingActionId !== null}
            aria-expanded={isExpanded?.(action.id)}
            onClick={submitActionId === action.id ? undefined : () => onAction(action)}
          >
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}
