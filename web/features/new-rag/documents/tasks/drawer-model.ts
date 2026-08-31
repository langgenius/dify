import type { BackgroundTask } from '../models'
import type { ProcessingTaskProgressEvent } from './events'
import { taskCanRetry, taskIsActive, taskVersionIsAfter } from '../model'

export const TASK_DRAWER_LIMIT = 100

export function taskTime(task: BackgroundTask) {
  return task.completedAt ?? task.updatedAt
}

export function taskLifecycle(task: BackgroundTask) {
  return `${task.updatedAt}:${task.state}`
}

export function taskProgress(task: BackgroundTask) {
  if (!task.progressTotal) return
  return {
    completed: Math.min(
      (task.progressCompleted ?? 0) + (task.progressFailed ?? 0),
      task.progressTotal,
    ),
    total: task.progressTotal,
  }
}

export function taskWithStreamProgress(
  task: BackgroundTask,
  progress: ProcessingTaskProgressEvent['data'] | undefined,
) {
  if (!progress || !taskIsActive(task) || taskVersionIsAfter(task.updatedAt, progress.updatedAt))
    return task
  const stateChanged = progress.state !== task.state
  return {
    ...task,
    ...(stateChanged ? { canCancel: undefined, canRetry: undefined } : {}),
    errorCode: undefined,
    errorMessage: undefined,
    failure: undefined,
    ...progress,
  }
}

export function compareTaskRecency(left: BackgroundTask, right: BackgroundTask) {
  if (taskVersionIsAfter(left.updatedAt, right.updatedAt)) return -1
  if (taskVersionIsAfter(right.updatedAt, left.updatedAt)) return 1
  return right.id.localeCompare(left.id)
}

export function newestTasks(
  tasks: BackgroundTask[],
  limit: number,
  predicate: (task: BackgroundTask) => boolean,
) {
  const selected: BackgroundTask[] = []
  for (const task of tasks) {
    if (!predicate(task)) continue
    let low = 0
    let high = selected.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (compareTaskRecency(task, selected[middle]!) < 0) high = middle
      else low = middle + 1
    }
    selected.splice(low, 0, task)
    if (selected.length > limit) selected.pop()
  }
  return selected
}

export function selectTaskDrawerTasks(tasks: BackgroundTask[], visibleTaskLimit: number) {
  const reservedLimit = Math.min(TASK_DRAWER_LIMIT / 2, visibleTaskLimit)
  const retryableTasks = newestTasks(tasks, reservedLimit, taskCanRetry)
  const activeTasks = newestTasks(tasks, reservedLimit, taskIsActive)
  const attentionTaskIds = new Set([
    ...retryableTasks.map((task) => task.id),
    ...activeTasks.map((task) => task.id),
  ])
  const remainingAttentionTasks = newestTasks(
    tasks,
    visibleTaskLimit - attentionTaskIds.size,
    (task) => (taskCanRetry(task) || taskIsActive(task)) && !attentionTaskIds.has(task.id),
  )
  for (const task of remainingAttentionTasks) attentionTaskIds.add(task.id)
  const terminalTasks = newestTasks(
    tasks,
    visibleTaskLimit - attentionTaskIds.size,
    (task) => !attentionTaskIds.has(task.id),
  )
  return [...retryableTasks, ...activeTasks, ...remainingAttentionTasks, ...terminalTasks].sort(
    compareTaskRecency,
  )
}
