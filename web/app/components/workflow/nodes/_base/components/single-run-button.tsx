import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'

type SingleRunButtonProps = {
  running?: boolean
  disabledReason?: string
  onClick: () => void
  className?: string
  compact?: boolean
  label?: string
  showLabel?: boolean
}

const SingleRunButton = ({
  running = false,
  disabledReason,
  onClick,
  className,
  compact = false,
  label,
  showLabel = false,
}: SingleRunButtonProps) => {
  const { t } = useTranslation(['workflow', 'workflowDebug'])
  const actionLabel =
    label ??
    (running
      ? t(($) => $['debug.variableInspect.trigger.stop'], { ns: 'workflowDebug' })
      : t(($) => $['panel.runThisStep'], { ns: 'workflow' }))
  const reason = running ? undefined : disabledReason
  const icon = (
    <span
      aria-hidden
      className={cn(
        running ? 'i-custom-vender-line-mediaAndDevices-stop' : 'i-ri-play-large-line',
        compact ? 'size-3' : 'size-4',
      )}
    />
  )
  const actionProps = {
    className,
    'aria-disabled': reason ? (true as const) : undefined,
    'aria-description': reason,
    'data-disabled': reason ? '' : undefined,
    // The unavailable action has no run handler. Its explanation stays reachable
    // through the popover on hover, keyboard activation, and touch.
    onClick: reason ? undefined : onClick,
  }
  const button = showLabel ? (
    <Button {...actionProps} size="small">
      {icon}
      {actionLabel}
    </Button>
  ) : (
    <IconButton {...actionProps} aria-label={actionLabel}>
      {icon}
    </IconButton>
  )

  if (reason) {
    return (
      <Popover>
        <PopoverTrigger openOnHover render={button} />
        <PopoverContent
          placement="top"
          aria-label={actionLabel}
          className="max-w-75 px-3 py-2 system-xs-regular text-text-secondary"
        >
          {reason}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Tooltip disabled={running || showLabel}>
      <TooltipTrigger render={button} />
      <TooltipContent>{actionLabel}</TooltipContent>
    </Tooltip>
  )
}

export default SingleRunButton
