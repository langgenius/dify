import { useCallback } from 'react'
import { TaskStatus } from '@/app/components/plugins/types'
import type { PluginStatus } from '@/app/components/plugins/types'
import {
  useMutationClearTaskPlugin,
  usePluginTaskList,
} from '@/service/use-plugins'

export const usePluginTaskStatus = () => {
  const {
    pluginTasks,
  } = usePluginTaskList()
  const { mutate } = useMutationClearTaskPlugin()
  const allPlugins = pluginTasks.filter(task => task.status !== TaskStatus.success).map(task => task.plugins.map((plugin) => {
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
    })
  }, [mutate])

  return {
    errorPlugins,
    successPlugins,
    runningPlugins,
    totalPluginsLength: allPlugins.length,
    handleClearErrorPlugin,
  }
}
