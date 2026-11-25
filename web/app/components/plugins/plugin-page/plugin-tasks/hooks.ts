import type { PluginStatus } from '@/app/components/plugins/types'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { TaskStatus } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'
import { usePluginTaskList } from '@/service/use-plugins'

const isUnfinishedStatus = (status: PluginStatus['status']) =>
  status === TaskStatus.pending || status === TaskStatus.running

export const usePluginTaskStatus = () => {
  const { pluginTasks, invalidatePluginTasks } = usePluginTaskList()
  const { mutateAsync } = useMutation(
    consoleQuery.workspaces.current.plugin.tasks.byTaskId.delete.byIdentifier.post.mutationOptions(),
  )
  const allPlugins = pluginTasks
    .map((task) =>
      task.plugins.map((plugin) => {
        return {
          ...plugin,
          taskId: task.id,
        }
      }),
    )
    .flat()
  const errorPlugins: PluginStatus[] = []
  const successPlugins: PluginStatus[] = []
  const runningPlugins: PluginStatus[] = []

  allPlugins.forEach((plugin) => {
    if (isUnfinishedStatus(plugin.status)) runningPlugins.push(plugin)
    if (plugin.status === TaskStatus.failed) errorPlugins.push(plugin)
    if (plugin.status === TaskStatus.success) successPlugins.push(plugin)
  })

  const handleClearErrorPlugin = useCallback(
    async (taskId: string, pluginId: string) => {
      await mutateAsync({ params: { task_id: taskId, identifier: pluginId } })
      void invalidatePluginTasks()
    },
    [mutateAsync, invalidatePluginTasks],
  )
  const totalPluginsLength = allPlugins.length
  const runningPluginsLength = runningPlugins.length
  const errorPluginsLength = errorPlugins.length
  const successPluginsLength = successPlugins.length

  const isInstalling =
    runningPluginsLength > 0 && errorPluginsLength === 0 && successPluginsLength === 0
  const isInstallingWithSuccess =
    runningPluginsLength > 0 && successPluginsLength > 0 && errorPluginsLength === 0
  const isInstallingWithError = runningPluginsLength > 0 && errorPluginsLength > 0
  const isSuccess = successPluginsLength === totalPluginsLength && totalPluginsLength > 0
  const isFailed =
    runningPluginsLength === 0 &&
    errorPluginsLength + successPluginsLength === totalPluginsLength &&
    totalPluginsLength > 0 &&
    errorPluginsLength > 0

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
