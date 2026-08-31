import type { DocumentProcessingTask } from '../models'
import { taskIsActive, taskVersionIsAfter } from '../model'

export type TerminalTaskPin = {
  observedAt: string
  taskListGeneration: number
}

export function mergeTaskOverride(
  task: DocumentProcessingTask,
  override: Partial<DocumentProcessingTask>,
): DocumentProcessingTask {
  const stateChanged = override.state !== undefined && override.state !== task.state
  return {
    ...task,
    ...(stateChanged ? { canCancel: undefined, canRetry: undefined } : {}),
    ...override,
  }
}

type EffectiveDocumentTasksOptions = {
  baseTasks: DocumentProcessingTask[]
  streamActiveOverrideVersions: ReadonlyMap<string, string>
  taskOverrides: Record<string, Partial<DocumentProcessingTask>>
  terminalTaskPins: Record<string, TerminalTaskPin>
}

export function effectiveDocumentTasks({
  baseTasks,
  streamActiveOverrideVersions,
  taskOverrides,
  terminalTaskPins,
}: EffectiveDocumentTasksOptions) {
  return baseTasks.map((task) => {
    const override = taskOverrides[task.id]
    const terminalTaskPin = terminalTaskPins[task.id]
    if (
      terminalTaskPin &&
      override &&
      taskIsActive(task) &&
      !taskVersionIsAfter(task.updatedAt, terminalTaskPin.observedAt)
    )
      return mergeTaskOverride(task, override)
    if (!override?.updatedAt) return override ? mergeTaskOverride(task, override) : task
    if (taskVersionIsAfter(task.updatedAt, override.updatedAt)) return task

    const mergedTask = mergeTaskOverride(task, override)
    const staleStreamOverrideWouldRestoreActiveTask =
      !taskIsActive(task) &&
      taskIsActive(mergedTask) &&
      !taskVersionIsAfter(override.updatedAt, task.updatedAt) &&
      streamActiveOverrideVersions.get(task.id) === override.updatedAt
    return staleStreamOverrideWouldRestoreActiveTask ? task : mergedTask
  })
}
