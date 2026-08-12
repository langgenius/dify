import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { ENVIRONMENT_TAB_LABEL_MAX_WIDTH } from './layout'

export function EnvironmentButton({
  active,
  name,
  textWidth,
  onClick,
}: {
  active: boolean
  name: string
  textWidth: number
  onClick: () => void
}) {
  const truncated = textWidth > ENVIRONMENT_TAB_LABEL_MAX_WIDTH

  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex h-7 max-w-22 shrink-0 items-center justify-center rounded-lg px-2 py-1.5 text-center system-sm-medium text-text-tertiary outline-hidden',
              'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              active && 'bg-state-base-active system-sm-semibold text-text-primary',
            )}
            onClick={onClick}
          >
            <span className="min-w-0 truncate">{name}</span>
          </button>
        }
      />
      <TooltipContent role="tooltip">{name}</TooltipContent>
    </Tooltip>
  )
}
