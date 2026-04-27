import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInstallLine,
} from '@remixicon/react'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'

type TaskStatusIndicatorProps = {
  tip: string
  isInstalling: boolean
  isInstallingWithSuccess: boolean
  isInstallingWithError: boolean
  isSuccess: boolean
  isFailed: boolean
  successPluginsLength: number
  runningPluginsLength: number
  totalPluginsLength: number
  onClick: () => void
}

const TaskStatusIndicator: FC<TaskStatusIndicatorProps> = ({
  tip,
  isInstalling,
  isInstallingWithSuccess,
  isInstallingWithError,
  isSuccess,
  isFailed,
  successPluginsLength,
  runningPluginsLength,
  totalPluginsLength,
  onClick,
}) => {
  const showDownloadingIcon = isInstalling || isInstallingWithError
  const showErrorStyle = isInstallingWithError || isFailed
  const showSuccessIcon = isSuccess || (successPluginsLength > 0 && runningPluginsLength === 0)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label={tip}
            className={cn(
              'relative flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover',
              'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              showErrorStyle && 'cursor-pointer border-components-button-destructive-secondary-border-hover bg-state-destructive-hover hover:bg-state-destructive-hover-alt',
              (isInstalling || isInstallingWithSuccess || isSuccess) && 'cursor-pointer hover:bg-components-button-secondary-bg-hover',
            )}
            id="plugin-task-trigger"
            onClick={onClick}
          >
            {showDownloadingIcon
              ? <DownloadingIcon />
              : (
                  <RiInstallLine
                    aria-hidden
                    className={cn(
                      'h-4 w-4 text-components-button-secondary-text',
                      showErrorStyle && 'text-components-button-destructive-secondary-text',
                    )}
                  />
                )}

            <div className="absolute -top-1 -right-1">
              {(isInstalling || isInstallingWithSuccess) && (
                <ProgressCircle
                  percentage={(totalPluginsLength > 0 ? successPluginsLength / totalPluginsLength : 0) * 100}
                  circleFillColor="fill-components-progress-brand-bg"
                />
              )}
              {isInstallingWithError && (
                <ProgressCircle
                  percentage={(totalPluginsLength > 0 ? runningPluginsLength / totalPluginsLength : 0) * 100}
                  circleFillColor="fill-components-progress-brand-bg"
                  sectorFillColor="fill-components-progress-error-border"
                  circleStrokeColor="stroke-components-progress-error-border"
                />
              )}
              {showSuccessIcon && !isInstalling && !isInstallingWithSuccess && !isInstallingWithError && (
                <RiCheckboxCircleFill aria-hidden className="h-3.5 w-3.5 text-text-success" />
              )}
              {isFailed && (
                <RiErrorWarningFill aria-hidden className="h-3.5 w-3.5 text-text-destructive" />
              )}
            </div>
          </button>
        )}
      />
      <TooltipContent sideOffset={8}>{tip}</TooltipContent>
    </Tooltip>
  )
}

export default TaskStatusIndicator
