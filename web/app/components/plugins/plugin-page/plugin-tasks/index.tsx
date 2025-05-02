import {
  useMemo,
  useState,
} from 'react'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInstallLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { usePluginTaskStatus } from './hooks'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import CardIcon from '@/app/components/plugins/card/base/card-icon'
import cn from '@/utils/classnames'
import { useGetLanguage } from '@/context/i18n'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'

const PluginTasks = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const [open, setOpen] = useState(false)
  const {
    errorPlugins,
    runningPluginsLength,
    successPluginsLength,
    errorPluginsLength,
    totalPluginsLength,
    isInstalling,
    isInstallingWithSuccess,
    isInstallingWithError,
    isSuccess,
    isFailed,
    handleClearErrorPlugin,
    handleClearAllErrorPlugin,
    opacity,
  } = usePluginTaskStatus()
  const { getIconUrl } = useGetIcon()

  const tip = useMemo(() => {
    if (isInstalling)
      return t('plugin.task.installing', { installingLength: runningPluginsLength })

    if (isInstallingWithSuccess)
      return t('plugin.task.installingWithSuccess', { installingLength: runningPluginsLength, successLength: successPluginsLength })

    if (isInstallingWithError)
      return t('plugin.task.installingWithError', { installingLength: runningPluginsLength, successLength: successPluginsLength, errorLength: errorPluginsLength })

    if (isFailed)
      return t('plugin.task.installError', { errorLength: errorPluginsLength })
  }, [isInstalling, isInstallingWithSuccess, isInstallingWithError, isFailed, errorPluginsLength, runningPluginsLength, successPluginsLength, t])

  if (!totalPluginsLength)
    return null

  return (
    <div
      className='flex items-center'
      style={{ opacity }}
    >
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-start'
        offset={{
          mainAxis: 4,
          crossAxis: 79,
        }}
      >
        <PortalToFollowElemTrigger
          onClick={() => {
            if (isFailed)
              setOpen(v => !v)
          }}
        >
          <Tooltip popupContent={tip}>
            <div
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover',
                (isInstallingWithError || isFailed) && 'cursor-pointer border-components-button-destructive-secondary-border-hover bg-state-destructive-hover hover:bg-state-destructive-hover-alt',
              )}
              id="plugin-task-trigger"
            >
              {
                (isInstalling || isInstallingWithError) && (
                  <DownloadingIcon />
                )
              }
              {
                !(isInstalling || isInstallingWithError) && (
                  <RiInstallLine
                    className={cn(
                      'h-4 w-4 text-components-button-secondary-text',
                      (isInstallingWithError || isFailed) && 'text-components-button-destructive-secondary-text',
                    )}
                  />
                )
              }
              <div className='absolute -right-1 -top-1'>
                {
                  (isInstalling || isInstallingWithSuccess) && (
                    <ProgressCircle
                      percentage={successPluginsLength / totalPluginsLength * 100}
                      circleFillColor='fill-components-progress-brand-bg'
                    />
                  )
                }
                {
                  isInstallingWithError && (
                    <ProgressCircle
                      percentage={runningPluginsLength / totalPluginsLength * 100}
                      circleFillColor='fill-components-progress-brand-bg'
                      sectorFillColor='fill-components-progress-error-border'
                      circleStrokeColor='stroke-components-progress-error-border'
                    />
                  )
                }
                {
                  isSuccess && (
                    <RiCheckboxCircleFill className='h-3.5 w-3.5 text-text-success' />
                  )
                }
                {
                  isFailed && (
                    <RiErrorWarningFill className='h-3.5 w-3.5 text-text-destructive' />
                  )
                }
              </div>
            </div>
          </Tooltip>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[11]'>
          <div className='w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 pb-2 shadow-lg'>
            <div className='system-sm-semibold-uppercase sticky top-0 flex h-7 items-center justify-between px-2 pt-1'>
              {t('plugin.task.installedError', { errorLength: errorPluginsLength })}
              <Button
                className='shrink-0'
                size='small'
                variant='ghost'
                onClick={() => handleClearAllErrorPlugin()}
              >
                {t('plugin.task.clearAll')}
              </Button>
            </div>
            <div className='max-h-[400px] overflow-y-auto'>
              {
                errorPlugins.map(errorPlugin => (
                  <div
                    key={errorPlugin.plugin_unique_identifier}
                    className='flex rounded-lg p-2 hover:bg-state-base-hover'
                  >
                    <div className='relative mr-2 flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'>
                      <RiErrorWarningFill className='absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 text-text-destructive' />
                      <CardIcon
                        size='tiny'
                        src={getIconUrl(errorPlugin.icon)}
                      />
                    </div>
                    <div className='grow'>
                      <div className='system-md-regular truncate text-text-secondary'>
                        {errorPlugin.labels[language]}
                      </div>
                      <div className='system-xs-regular break-all text-text-destructive'>
                        {errorPlugin.message}
                      </div>
                    </div>
                    <Button
                      className='shrink-0'
                      size='small'
                      variant='ghost'
                      onClick={() => handleClearErrorPlugin(errorPlugin.taskId, errorPlugin.plugin_unique_identifier)}
                    >
                      {t('common.operation.clear')}
                    </Button>
                  </div>
                ))
              }
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default PluginTasks
