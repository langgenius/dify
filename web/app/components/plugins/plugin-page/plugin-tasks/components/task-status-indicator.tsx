import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'

type TaskStatusIndicatorProps = {
  tip: string
  isInstalling: boolean
  isInstallingWithSuccess: boolean
  isInstallingWithError: boolean
  isSuccess: boolean
  isFailed: boolean
  disabled?: boolean
  isOpen?: boolean
  successPluginsLength: number
  runningPluginsLength: number
  totalPluginsLength: number
  onClick: () => void
}

function ErrorBadgeIcon() {
  return (
    <svg
      aria-hidden
      data-status-badge="error"
      data-testid="task-status-error-badge"
      className="size-3.5 text-text-destructive"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10m-1-7v2h2v-2zm0-8v6h2V7z"
      />
    </svg>
  )
}

function SuccessBadgeIcon() {
  return (
    <svg
      aria-hidden
      data-status-badge="success"
      data-testid="task-status-success-badge"
      className="size-3.5 text-text-success"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10m5.457-12.543L11 15.914l-4.207-4.207l1.414-1.414L11 13.086l5.043-5.043z"
      />
    </svg>
  )
}

function TaskStatusIndicator({
  tip,
  isInstalling,
  isInstallingWithSuccess,
  isInstallingWithError,
  isSuccess,
  isFailed,
  disabled = false,
  isOpen = false,
  successPluginsLength,
  runningPluginsLength,
  onClick,
}: TaskStatusIndicatorProps) {
  const showErrorStyle = isInstallingWithError || isFailed
  const hasActiveInstall = isInstalling || isInstallingWithSuccess || isInstallingWithError
  const showSuccessIcon =
    isSuccess ||
    (!hasActiveInstall && !isFailed && successPluginsLength > 0 && runningPluginsLength === 0)
  const showSuccessBadge = showSuccessIcon && !isInstallingWithError && !isFailed
  const showBadge = isInstallingWithError || showSuccessBadge || isFailed
  const isClickable = !disabled && (hasActiveInstall || isSuccess || isFailed)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={disabled}
            aria-label={tip}
            className={cn(
              'relative size-8 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-bg p-2 shadow-none',
              'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              isClickable ? 'cursor-pointer' : 'cursor-default',
              showErrorStyle &&
                'cursor-pointer border-components-button-destructive-secondary-border-hover bg-state-destructive-hover text-components-button-destructive-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] hover:bg-state-destructive-hover-alt',
              isOpen &&
                !showErrorStyle &&
                'border-components-button-secondary-border-hover bg-components-button-secondary-bg-hover shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
              isOpen && showErrorStyle && 'bg-state-destructive-hover-alt',
            )}
            id="plugin-task-trigger"
            onClick={onClick}
          >
            <DownloadingIcon active={hasActiveInstall} />

            {showBadge && (
              <div className="absolute -top-1.5 -right-1.5 box-content flex size-3.5 items-center justify-center rounded-full border border-components-panel-bg bg-components-panel-bg">
                {isInstallingWithError && <ErrorBadgeIcon />}
                {showSuccessBadge && <SuccessBadgeIcon />}
                {isFailed && <ErrorBadgeIcon />}
              </div>
            )}
          </Button>
        }
      />
      <TooltipContent sideOffset={8}>{tip}</TooltipContent>
    </Tooltip>
  )
}

export default TaskStatusIndicator
