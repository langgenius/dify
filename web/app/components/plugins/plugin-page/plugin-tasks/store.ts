import { create } from 'zustand'
import type { PluginTask } from '@/app/components/plugins/types'
import { fetchPluginTasks } from '@/service/plugins'

type PluginTasksStore = {
  pluginTasks: PluginTask[]
  setPluginTasks: (tasks: PluginTask[]) => void
  setPluginTasksWithPolling: () => void
}

let pluginTasksTimer: NodeJS.Timeout | null = null

export const usePluginTasksStore = create<PluginTasksStore>(set => ({
  pluginTasks: [],
  setPluginTasks: (tasks: PluginTask[]) => set({ pluginTasks: tasks }),
  setPluginTasksWithPolling: async () => {
    if (pluginTasksTimer) {
      clearTimeout(pluginTasksTimer)
      pluginTasksTimer = null
    }
    const handleUpdatePluginTasks = async () => {
      const { tasks } = await fetchPluginTasks()
      set({ pluginTasks: tasks })

      if (tasks.length && !tasks.every(task => task.status === 'success')) {
        pluginTasksTimer = setTimeout(() => {
          handleUpdatePluginTasks()
        }, 5000)
      }
      else {
        if (pluginTasksTimer) {
          clearTimeout(pluginTasksTimer)
          pluginTasksTimer = null
        }
      }
    }

    handleUpdatePluginTasks()
  },
}))
