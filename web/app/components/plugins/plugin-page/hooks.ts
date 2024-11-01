import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useRequest } from 'ahooks'
import type { PluginTask } from '../types'
import { fetchPluginTasks } from '@/service/plugins'

export const usePluginTasks = () => {
  const [pluginTasks, setPluginTasks] = useState<PluginTask[]>([])

  const handleUpdatePluginTasks = async (callback: (tasks: PluginTask[]) => void) => {
    const { tasks } = await fetchPluginTasks()
    setPluginTasks(tasks)
    callback(tasks)
  }

  const { run, cancel } = useRequest(handleUpdatePluginTasks, {
    manual: true,
    pollingInterval: 3000,
    pollingErrorRetryCount: 2,
  })

  const checkHasPluginTasks = useCallback((tasks: PluginTask[]) => {
    if (!tasks.length)
      cancel()
  }, [cancel])

  useEffect(() => {
    run(checkHasPluginTasks)
  }, [run, checkHasPluginTasks])

  return {
    pluginTasks,
  }
}
