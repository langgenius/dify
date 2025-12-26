import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInstallLine,
} from '@remixicon/react'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import Tooltip from '@/app/components/base/tooltip'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'
import { cn } from '@/utils/classnames'

type PluginTaskTriggerProps = {
  tip: string
  isInstalling: boolean
  isInstallingWithSuccess: boolean
  isInstallingWithError: boolean
  isSuccess: boolean
  isFailed: boolean
  successPluginsLength: number
  runningPluginsLength: number
  errorPluginsLength: number
  totalPluginsLength: number
}

const PluginTaskTrigger = ({
  tip,
  isInstalling,
  isInstallingWithSuccess,
  isInstallingWithError,
  isSuccess,
  isFailed,
  successPluginsLength,
  runningPluginsLength,
  errorPluginsLength,
  totalPluginsLength,
}: PluginTaskTriggerProps) => {
  const showDownloadingIcon = isInstalling || isInstallingWithError
  const hasError = isInstallingWithError || isFailed
  const showSuccessIndicator = isSuccess || (successPluginsLength > 0 && runningPluginsLength === 0 && errorPluginsLength === 0)

  return (
    <Tooltip
      popupContent={tip}
      asChild
      offset={8}
    >
      <div
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover',
          hasError && 'cursor-pointer border-components-button-destructive-secondary-border-hover bg-state-destructive-hover hover:bg-state-destructive-hover-alt',
          (isInstalling || isInstallingWithSuccess || isSuccess) && 'cursor-pointer hover:bg-components-button-secondary-bg-hover',
        )}
        id="plugin-task-trigger"
      >
        {/* Main Icon */}
        {showDownloadingIcon
          ? <DownloadingIcon />
          : (
              <RiInstallLine
                className={cn(
                  'h-4 w-4 text-components-button-secondary-text',
                  hasError && 'text-components-button-destructive-secondary-text',
                )}
              />
            )}

        {/* Status Indicator */}
        <div className="absolute -right-1 -top-1">
          {(isInstalling || isInstallingWithSuccess) && (
            <ProgressCircle
              percentage={successPluginsLength / totalPluginsLength * 100}
              circleFillColor="fill-components-progress-brand-bg"
            />
          )}
          {isInstallingWithError && (
            <ProgressCircle
              percentage={runningPluginsLength / totalPluginsLength * 100}
              circleFillColor="fill-components-progress-brand-bg"
              sectorFillColor="fill-components-progress-error-border"
              circleStrokeColor="stroke-components-progress-error-border"
            />
          )}
          {showSuccessIndicator && (
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

export default PluginTaskTrigger
