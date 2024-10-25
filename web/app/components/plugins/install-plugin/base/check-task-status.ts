import { checkTaskStatus as fetchCheckTaskStatus } from '@/service/plugins'
import type { PluginStatus } from '../../types'
import { TaskStatus } from '../../types'

const INTERVAL = 10 * 1000 // 10 seconds

interface Params {
  taskId: string
  pluginUniqueIdentifier: string
}

function checkTaskStatus() {
  let nextStatus = TaskStatus.running
  let isStop = false

  const doCheckStatus = async ({
    taskId,
    pluginUniqueIdentifier,
  }: Params) => {
    if (isStop) return
    const { plugins } = await fetchCheckTaskStatus(taskId)
    const plugin = plugins.find((p: PluginStatus) => p.plugin_unique_identifier === pluginUniqueIdentifier)
    if (!plugin) {
      nextStatus = TaskStatus.failed
      Promise.reject(new Error('Plugin package not found'))
      return
    }
    nextStatus = plugin.status
    if (nextStatus === TaskStatus.running) {
      setTimeout(async () => {
        await doCheckStatus({
          taskId,
          pluginUniqueIdentifier,
        })
      }, INTERVAL)
      return
    }
    if (nextStatus === TaskStatus.failed) {
      Promise.reject(plugin.message)
      return
    }
    return ({
      status: nextStatus,
    })
  }

  return {
    check: doCheckStatus,
    stop: () => {
      isStop = true
    },
  }
}

export default checkTaskStatus
