import type { FC } from 'react'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInstallLine,
} from '@remixicon/react'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import Tooltip from '@/app/components/base/tooltip'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'
import { cn } from '@/utils/classnames'

export type TaskStatusIndicatorProps = {
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
    <Tooltip
      popupContent={tip}
      asChild
      offset={8}
    >
      <div
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover',
          showErrorStyle && 'cursor-pointer border-components-button-destructive-secondary-border-hover bg-state-destructive-hover hover:bg-state-destructive-hover-alt',
          (isInstalling || isInstallingWithSuccess || isSuccess) && 'cursor-pointer hover:bg-components-button-secondary-bg-hover',
        )}
        id="plugin-task-trigger"
        onClick={onClick}
      >
        {/* Main Icon */}
        {showDownloadingIcon
          ? <DownloadingIcon />
          : (
              <RiInstallLine
                className={cn(
                  'h-4 w-4 text-components-button-secondary-text',
                  showErrorStyle && 'text-components-button-destructive-secondary-text',
                )}
              />
            )}

        {/* Status Indicator Badge */}
        <div className="absolute -right-1 -top-1">
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
            <RiCheckboxCircleFill className="h-3.5 w-3.5 text-text-success" />
          )}
          {isFailed && (
            <RiErrorWarningFill className="h-3.5 w-3.5 text-text-destructive" />
          )}
        </div>
      </div>
    </Tooltip>
  )
}

export default TaskStatusIndicator
