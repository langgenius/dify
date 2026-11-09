import type { ProcessingTaskProgressEvent } from './events'
import { taskVersionIsAfter } from '../model'

type TaskProgress = ProcessingTaskProgressEvent['data']
type Listener = () => void

export type TaskProgressStore = {
  delete: (taskId: string) => void
  get: (taskId: string) => TaskProgress | undefined
  getSnapshot: () => number
  retain: (taskIds: Set<string>) => void
  set: (taskId: string, progress: TaskProgress) => void
  subscribe: (listener: Listener) => () => void
  subscribeTask: (taskId: string, listener: Listener) => () => void
}

export function createTaskProgressStore(): TaskProgressStore {
  const progressByTaskId = new Map<string, TaskProgress>()
  const listeners = new Set<Listener>()
  const taskListeners = new Map<string, Set<Listener>>()
  let revision = 0

  const emit = (taskIds: Iterable<string>) => {
    revision += 1
    for (const listener of listeners) listener()
    for (const taskId of taskIds) for (const listener of taskListeners.get(taskId) ?? []) listener()
  }

  return {
    delete(taskId) {
      if (!progressByTaskId.delete(taskId)) return
      emit([taskId])
    },
    get: (taskId) => progressByTaskId.get(taskId),
    getSnapshot: () => revision,
    retain(taskIds) {
      let changed = false
      const deletedTaskIds: string[] = []
      for (const taskId of progressByTaskId.keys()) {
        if (taskIds.has(taskId)) continue
        progressByTaskId.delete(taskId)
        changed = true
        deletedTaskIds.push(taskId)
      }
      if (changed) emit(deletedTaskIds)
    },
    set(taskId, progress) {
      const current = progressByTaskId.get(taskId)
      if (current && taskVersionIsAfter(current.updatedAt, progress.updatedAt)) return
      progressByTaskId.set(taskId, progress)
      emit([taskId])
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeTask(taskId, listener) {
      const listeners = taskListeners.get(taskId) ?? new Set<Listener>()
      listeners.add(listener)
      taskListeners.set(taskId, listeners)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) taskListeners.delete(taskId)
      }
    },
  }
}
