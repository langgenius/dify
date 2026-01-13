import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import PluginTaskList from './components/plugin-task-list'
import TaskStatusIndicator from './components/task-status-indicator'
import { usePluginTaskStatus } from './hooks'

const PluginTasks = () => {
  const { t } = useTranslation()
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

  // Generate tooltip text based on status
  const tip = useMemo(() => {
    if (isInstallingWithError)
      return t('task.installingWithError', { ns: 'plugin', installingLength: runningPluginsLength, successLength: successPluginsLength, errorLength: errorPluginsLength })
    if (isInstallingWithSuccess)
      return t('task.installingWithSuccess', { ns: 'plugin', installingLength: runningPluginsLength, successLength: successPluginsLength })
    if (isInstalling)
      return t('task.installing', { ns: 'plugin' })
    if (isFailed)
      return t('task.installedError', { ns: 'plugin', errorLength: errorPluginsLength })
    if (isSuccess)
      return t('task.installSuccess', { ns: 'plugin', successLength: successPluginsLength })
    return t('task.installed', { ns: 'plugin' })
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

  // Clear handlers
  const handleClearAll = useCallback(async () => {
    const completedPlugins = [...successPlugins, ...errorPlugins]
    for (const plugin of completedPlugins)
      await handleClearErrorPlugin(plugin.taskId, plugin.plugin_unique_identifier)
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [successPlugins, errorPlugins, handleClearErrorPlugin, runningPluginsLength])

  const handleClearErrors = useCallback(async () => {
    for (const plugin of errorPlugins)
      await handleClearErrorPlugin(plugin.taskId, plugin.plugin_unique_identifier)
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [errorPlugins, handleClearErrorPlugin, runningPluginsLength])

  const handleClearSingle = useCallback(async (taskId: string, pluginId: string) => {
    await handleClearErrorPlugin(taskId, pluginId)
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [handleClearErrorPlugin, runningPluginsLength])

  const handleTriggerClick = useCallback(() => {
    if (isFailed || isInstalling || isInstallingWithSuccess || isInstallingWithError || isSuccess)
      setOpen(v => !v)
  }, [isFailed, isInstalling, isInstallingWithSuccess, isInstallingWithError, isSuccess])

  // Hide when no plugin tasks
  if (totalPluginsLength === 0)
    return null

  return (
    <div className="flex items-center">
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        offset={{
          mainAxis: 4,
          crossAxis: 79,
        }}
      >
        <PortalToFollowElemTrigger onClick={handleTriggerClick}>
          <TaskStatusIndicator
            tip={tip}
            isInstalling={isInstalling}
            isInstallingWithSuccess={isInstallingWithSuccess}
            isInstallingWithError={isInstallingWithError}
            isSuccess={isSuccess}
            isFailed={isFailed}
            successPluginsLength={successPluginsLength}
            runningPluginsLength={runningPluginsLength}
            totalPluginsLength={totalPluginsLength}
            onClick={() => {}}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[11]">
          <PluginTaskList
            runningPlugins={runningPlugins}
            successPlugins={successPlugins}
            errorPlugins={errorPlugins}
            getIconUrl={getIconUrl}
            onClearAll={handleClearAll}
            onClearErrors={handleClearErrors}
            onClearSingle={handleClearSingle}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default PluginTasks
