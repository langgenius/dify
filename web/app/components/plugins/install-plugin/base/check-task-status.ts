import { delay } from 'es-toolkit/promise'
import { checkTaskStatus as fetchCheckTaskStatus } from '@/service/plugins'
import { TaskStatus } from '../../types'

const INTERVAL = 10 * 1000 // 10 seconds
const isUnfinishedStatus = (status: TaskStatus) =>
  status === TaskStatus.pending || status === TaskStatus.running

type Params = {
  signal?: AbortSignal
  taskId: string
  pluginUniqueIdentifier: string
}

function checkTaskStatus() {
  let nextStatus: TaskStatus = TaskStatus.running
  let isStop = false

  const doCheckStatus = async ({ taskId, pluginUniqueIdentifier, signal }: Params) => {
    signal?.throwIfAborted()
    if (isStop) {
      return {
        status: TaskStatus.success,
      }
    }
    const res = await fetchCheckTaskStatus(taskId, signal)
    signal?.throwIfAborted()
    const { plugins } = res.task
    const plugin = plugins.find((p) => p.plugin_unique_identifier === pluginUniqueIdentifier)
    if (!plugin) {
      nextStatus = TaskStatus.failed
      return {
        status: TaskStatus.failed,
        error: 'Plugin package not found',
      }
    }
    nextStatus = plugin.status
    if (isUnfinishedStatus(nextStatus)) {
      await delay(INTERVAL, { signal })
      return await doCheckStatus({
        signal,
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
    return {
      status: TaskStatus.success,
    }
  }

  return {
    check: doCheckStatus,
    stop: () => {
      isStop = true
    },
  }
}

export default checkTaskStatus
