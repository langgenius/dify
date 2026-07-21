import type { ProcessingTaskProgressEvent } from './services/processing-task-events'
import { taskVersionIsAfter } from './document-model'

type TaskProgress = ProcessingTaskProgressEvent['data']
type Listener = () => void

export type TaskProgressStore = {
  delete: (taskId: string) => void
  get: (taskId: string) => TaskProgress | undefined
  getSnapshot: () => number
  retain: (taskIds: Set<string>) => void
  set: (taskId: string, progress: TaskProgress) => void
  subscribe: (listener: Listener) => () => void
}

export function createTaskProgressStore(): TaskProgressStore {
  const progressByTaskId = new Map<string, TaskProgress>()
  const listeners = new Set<Listener>()
  let revision = 0

  const emit = () => {
    revision += 1
    for (const listener of listeners) listener()
  }

  return {
    delete(taskId) {
      if (!progressByTaskId.delete(taskId)) return
      emit()
    },
    get: (taskId) => progressByTaskId.get(taskId),
    getSnapshot: () => revision,
    retain(taskIds) {
      let changed = false
      for (const taskId of progressByTaskId.keys()) {
        if (taskIds.has(taskId)) continue
        progressByTaskId.delete(taskId)
        changed = true
      }
      if (changed) emit()
    },
    set(taskId, progress) {
      const current = progressByTaskId.get(taskId)
      if (current && taskVersionIsAfter(current.updatedAt, progress.updatedAt)) return
      progressByTaskId.set(taskId, progress)
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
