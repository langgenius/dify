import type { PluginStatus } from '@/app/components/plugins/types'
import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { TaskStatus } from '@/app/components/plugins/types'
import {
  useMutationClearTaskPlugin,
  usePluginTaskList,
} from '@/service/use-plugins'

export const usePluginTaskStatus = () => {
  const { t } = useTranslation()
  const {
    pluginTasks,
    handleRefetch,
  } = usePluginTaskList()
  const { mutate } = useMutationClearTaskPlugin()
  const allPlugins = pluginTasks.map(task => task.plugins.map((plugin) => {
    return {
      ...plugin,
      taskId: task.id,
    }
  })).flat()
  const errorPlugins: PluginStatus[] = []
  const successPlugins: PluginStatus[] = []
  const runningPlugins: PluginStatus[] = []

  allPlugins.forEach((plugin) => {
    if (plugin.status === TaskStatus.running)
      runningPlugins.push(plugin)
    if (plugin.status === TaskStatus.failed)
      errorPlugins.push(plugin)
    if (plugin.status === TaskStatus.success)
      successPlugins.push(plugin)
  })

  const handleClearErrorPlugin = useCallback((taskId: string, pluginId: string) => {
    mutate({
      taskId,
      pluginId,
    }, {
      onSuccess: () => {
        handleRefetch()
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || t('api.actionFailed', { ns: 'common' }),
        })
      },
    })
  }, [mutate, handleRefetch, t])
  const totalPluginsLength = allPlugins.length
  const runningPluginsLength = runningPlugins.length
  const errorPluginsLength = errorPlugins.length
  const successPluginsLength = successPlugins.length

  const isInstalling = runningPluginsLength > 0 && errorPluginsLength === 0 && successPluginsLength === 0
  const isInstallingWithSuccess = runningPluginsLength > 0 && successPluginsLength > 0 && errorPluginsLength === 0
  const isInstallingWithError = runningPluginsLength > 0 && errorPluginsLength > 0
  const isSuccess = successPluginsLength === totalPluginsLength && totalPluginsLength > 0
  const isFailed = runningPluginsLength === 0 && (errorPluginsLength + successPluginsLength) === totalPluginsLength && totalPluginsLength > 0 && errorPluginsLength > 0

  return {
    errorPlugins,
    successPlugins,
    runningPlugins,
    runningPluginsLength,
    errorPluginsLength,
    successPluginsLength,
    totalPluginsLength,
    isInstalling,
    isInstallingWithSuccess,
    isInstallingWithError,
    isSuccess,
    isFailed,
    handleClearErrorPlugin,
  }
}
