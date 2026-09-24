import type { IconButtonProps } from '@langgenius/dify-ui/icon-button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'
import styles from './task-status-indicator.module.css'

type TaskStatusIndicatorProps = Omit<
  IconButtonProps,
  'aria-label' | 'aria-labelledby' | 'children' | 'size' | 'tone' | 'variant'
> & {
  tip: string
  isInstalling: boolean
  isInstallingWithSuccess: boolean
  isInstallingWithError: boolean
  isSuccess: boolean
  isFailed: boolean
  successPluginsLength: number
  runningPluginsLength: number
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
  successPluginsLength,
  runningPluginsLength,
  className,
  ...buttonProps
}: TaskStatusIndicatorProps) {
  const showErrorStyle = isInstallingWithError || isFailed
  const hasActiveInstall = isInstalling || isInstallingWithSuccess || isInstallingWithError
  const showSuccessIcon =
    isSuccess ||
    (!hasActiveInstall && !isFailed && successPluginsLength > 0 && runningPluginsLength === 0)
  const showSuccessBadge = showSuccessIcon && !isInstallingWithError && !isFailed
  const showBadge = isInstallingWithError || showSuccessBadge || isFailed

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            {...buttonProps}
            aria-label={tip}
            variant="secondary"
            size="lg"
            focusableWhenDisabled
            data-error={showErrorStyle ? '' : undefined}
            className={cn(styles.indicator, className)}
          >
            <span aria-hidden className="contents">
              <DownloadingIcon active={hasActiveInstall} />
              {showBadge && (
                <span className="absolute -top-1.5 -right-1.5 box-content flex size-3.5 items-center justify-center rounded-full border border-components-panel-bg bg-components-panel-bg">
                  {isInstallingWithError && <ErrorBadgeIcon />}
                  {showSuccessBadge && <SuccessBadgeIcon />}
                  {isFailed && <ErrorBadgeIcon />}
                </span>
              )}
            </span>
          </IconButton>
        }
      />
      <TooltipContent sideOffset={8}>{tip}</TooltipContent>
    </Tooltip>
  )
}

export default TaskStatusIndicator
