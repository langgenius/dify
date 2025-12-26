import type { PluginStatus } from '@/app/components/plugins/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginTaskStatus } from './hooks'

type PluginTaskPanelState = {
  open: boolean
  setOpen: (open: boolean) => void
  tip: string
  taskStatus: ReturnType<typeof usePluginTaskStatus>
  handleClearAll: () => Promise<void>
  handleClearErrors: () => Promise<void>
  handleClearSingle: (taskId: string, pluginId: string) => Promise<void>
}

export const usePluginTaskPanel = (): PluginTaskPanelState => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const taskStatus = usePluginTaskStatus()

  const {
    errorPlugins,
    successPlugins,
    runningPluginsLength,
    successPluginsLength,
    errorPluginsLength,
    isInstalling,
    isInstallingWithSuccess,
    isInstallingWithError,
    isSuccess,
    isFailed,
    handleClearErrorPlugin,
  } = taskStatus

  const closeIfNoRunning = useCallback(() => {
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [runningPluginsLength])

  const clearPlugins = useCallback(async (plugins: PluginStatus[]) => {
    for (const plugin of plugins)
      await handleClearErrorPlugin(plugin.taskId, plugin.plugin_unique_identifier)
  }, [handleClearErrorPlugin])

  const handleClearAll = useCallback(async () => {
    // Clear all completed plugins (success and error) but keep running ones
    await clearPlugins([...successPlugins, ...errorPlugins])
    closeIfNoRunning()
  }, [successPlugins, errorPlugins, clearPlugins, closeIfNoRunning])

  const handleClearErrors = useCallback(async () => {
    await clearPlugins(errorPlugins)
    closeIfNoRunning()
  }, [errorPlugins, clearPlugins, closeIfNoRunning])

  const handleClearSingle = useCallback(async (taskId: string, pluginId: string) => {
    await handleClearErrorPlugin(taskId, pluginId)
    closeIfNoRunning()
  }, [handleClearErrorPlugin, closeIfNoRunning])

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

  return {
    open,
    setOpen,
    tip,
    taskStatus,
    handleClearAll,
    handleClearErrors,
    handleClearSingle,
  }
}
