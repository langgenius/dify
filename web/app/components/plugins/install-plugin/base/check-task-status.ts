import { checkTaskStatus as fetchCheckTaskStatus } from '@/service/plugins'
import type { PluginStatus } from '../../types'
import { TaskStatus } from '../../types'
import { sleep } from '@/utils'

const INTERVAL = 10 * 1000 // 10 seconds

type Params = {
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
    if (isStop) {
      return {
        status: TaskStatus.success,
      }
    }
    const res = await fetchCheckTaskStatus(taskId)
    const { plugins } = res.task
    const plugin = plugins.find((p: PluginStatus) => p.plugin_unique_identifier === pluginUniqueIdentifier)
    if (!plugin) {
      nextStatus = TaskStatus.failed
      return {
        status: TaskStatus.failed,
        error: 'Plugin package not found',
      }
    }
    nextStatus = plugin.status
    if (nextStatus === TaskStatus.running) {
      await sleep(INTERVAL)
      return await doCheckStatus({
        taskId,
        pluginUniqueIdentifier,
      })
    }
    if (nextStatus === TaskStatus.failed) {
      return {
        status: TaskStatus.failed,
        error: plugin.message,
      }
    }
    return ({
      status: TaskStatus.success,
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
