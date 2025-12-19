import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInstallLine,
  RiLoaderLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { usePluginTaskStatus } from './hooks'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import CardIcon from '@/app/components/plugins/card/base/card-icon'
import { cn } from '@/utils/classnames'
import { useGetLanguage } from '@/context/i18n'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import DownloadingIcon from '@/app/components/header/plugins-nav/downloading-icon'
import Tooltip from '@/app/components/base/tooltip'

const PluginTasks = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const [open, setOpen] = useState(false)
  const {
    errorPlugins,
    successPlugins,
    runningPlugins,
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
  } = usePluginTaskStatus()
  const { getIconUrl } = useGetIcon()

  const handleClearAllWithModal = useCallback(async () => {
    // Clear all completed plugins (success and error) but keep running ones
    const completedPlugins = [...successPlugins, ...errorPlugins]

    // Clear all completed plugins individually
    for (const plugin of completedPlugins)
      await handleClearErrorPlugin(plugin.taskId, plugin.plugin_unique_identifier)

    // Only close modal if no plugins are still installing
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [successPlugins, errorPlugins, handleClearErrorPlugin, runningPluginsLength])

  const handleClearErrorsWithModal = useCallback(async () => {
    // Clear only error plugins, not all plugins
    for (const plugin of errorPlugins)
      await handleClearErrorPlugin(plugin.taskId, plugin.plugin_unique_identifier)
    // Only close modal if no plugins are still installing
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [errorPlugins, handleClearErrorPlugin, runningPluginsLength])

  const handleClearSingleWithModal = useCallback(async (taskId: string, pluginId: string) => {
    await handleClearErrorPlugin(taskId, pluginId)
    // Only close modal if no plugins are still installing
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [handleClearErrorPlugin, runningPluginsLength])

  const tip = useMemo(() => {
    if (isInstallingWithError)
      return t('plugin.task.installingWithError', { installingLength: runningPluginsLength, successLength: successPluginsLength, errorLength: errorPluginsLength })
    if (isInstallingWithSuccess)
      return t('plugin.task.installingWithSuccess', { installingLength: runningPluginsLength, successLength: successPluginsLength })
    if (isInstalling)
      return t('plugin.task.installing')
    if (isFailed)
      return t('plugin.task.installedError', { errorLength: errorPluginsLength })
    if (isSuccess)
      return t('plugin.task.installSuccess', { successLength: successPluginsLength })
    return t('plugin.task.installed')
  }, [
    errorPluginsLength,
    isFailed,
    isInstalling,
    isInstallingWithError,
    isInstallingWithSuccess,
    isSuccess,
    runningPluginsLength,
    successPluginsLength,
    t,
  ])

  // Show icon if there are any plugin tasks (completed, running, or failed)
  // Only hide when there are absolutely no plugin tasks
  if (totalPluginsLength === 0)
    return null

  return (
    <div className='flex items-center'>
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
            if (isFailed || isInstalling || isInstallingWithSuccess || isInstallingWithError || isSuccess)
              setOpen(v => !v)
          }}
        >
          <Tooltip
            popupContent={tip}
            asChild
            offset={8}
          >
            <div
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover',
                (isInstallingWithError || isFailed) && 'cursor-pointer border-components-button-destructive-secondary-border-hover bg-state-destructive-hover hover:bg-state-destructive-hover-alt',
                (isInstalling || isInstallingWithSuccess || isSuccess) && 'cursor-pointer hover:bg-components-button-secondary-bg-hover',
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
                  (isSuccess || (successPluginsLength > 0 && runningPluginsLength === 0 && errorPluginsLength === 0)) && (
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
          <div className='w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
            {/* Running Plugins */}
            {runningPlugins.length > 0 && (
              <>
                <div className='system-sm-semibold-uppercase sticky top-0 flex h-7 items-center justify-between px-2 pt-1 text-text-secondary'>
                  {t('plugin.task.installing')} ({runningPlugins.length})
                </div>
                <div className='max-h-[200px] overflow-y-auto'>
                  {runningPlugins.map(runningPlugin => (
                    <div
                      key={runningPlugin.plugin_unique_identifier}
                      className='flex items-center rounded-lg p-2 hover:bg-state-base-hover'
                    >
                      <div className='relative mr-2 flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'>
                        <RiLoaderLine className='absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 animate-spin text-text-accent' />
                        <CardIcon
                          size='tiny'
                          src={getIconUrl(runningPlugin.icon)}
                        />
                      </div>
                      <div className='grow'>
                        <div className='system-md-regular truncate text-text-secondary'>
                          {runningPlugin.labels[language]}
                        </div>
                        <div className='system-xs-regular text-text-tertiary'>
                          {t('plugin.task.installing')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Success Plugins */}
            {successPlugins.length > 0 && (
              <>
                <div className='system-sm-semibold-uppercase sticky top-0 flex h-7 items-center justify-between px-2 pt-1 text-text-secondary'>
                  {t('plugin.task.installed')} ({successPlugins.length})
                  <Button
                    className='shrink-0'
                    size='small'
                    variant='ghost'
                    onClick={() => handleClearAllWithModal()}
                  >
                    {t('plugin.task.clearAll')}
                  </Button>
                </div>
                <div className='max-h-[200px] overflow-y-auto'>
                  {successPlugins.map(successPlugin => (
                    <div
                      key={successPlugin.plugin_unique_identifier}
                      className='flex items-center rounded-lg p-2 hover:bg-state-base-hover'
                    >
                      <div className='relative mr-2 flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'>
                        <RiCheckboxCircleFill className='absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 text-text-success' />
                        <CardIcon
                          size='tiny'
                          src={getIconUrl(successPlugin.icon)}
                        />
                      </div>
                      <div className='grow'>
                        <div className='system-md-regular truncate text-text-secondary'>
                          {successPlugin.labels[language]}
                        </div>
                        <div className='system-xs-regular text-text-success'>
                          {successPlugin.message || t('plugin.task.installed')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Error Plugins */}
            {errorPlugins.length > 0 && (
              <>
                <div className='system-sm-semibold-uppercase sticky top-0 flex h-7 items-center justify-between px-2 pt-1 text-text-secondary'>
                  {t('plugin.task.installError', { errorLength: errorPlugins.length })}
                  <Button
                    className='shrink-0'
                    size='small'
                    variant='ghost'
                    onClick={() => handleClearErrorsWithModal()}
                  >
                    {t('plugin.task.clearAll')}
                  </Button>
                </div>
                <div className='max-h-[200px] overflow-y-auto'>
                  {errorPlugins.map(errorPlugin => (
                    <div
                      key={errorPlugin.plugin_unique_identifier}
                      className='flex items-center rounded-lg p-2 hover:bg-state-base-hover'
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
                        onClick={() => handleClearSingleWithModal(errorPlugin.taskId, errorPlugin.plugin_unique_identifier)}
                      >
                        {t('common.operation.clear')}
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default PluginTasks
