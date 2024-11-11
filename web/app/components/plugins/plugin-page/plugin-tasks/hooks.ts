import { usePluginTasksStore } from './store'
import { TaskStatus } from '@/app/components/plugins/types'
import type { PluginStatus } from '@/app/components/plugins/types'

export const usePluginTaskStatus = () => {
  const pluginTasks = usePluginTasksStore(s => s.pluginTasks)
  const allPlugins = pluginTasks.map(task => task.plugins).flat()
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

  return {
    errorPlugins,
    successPlugins,
    runningPlugins,
    totalPluginsLength: allPlugins.length,
  }
}
