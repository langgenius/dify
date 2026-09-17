import type { DocumentProcessingTask, LogicalDocument } from '../models'
import { taskIsActive, taskVersionIsAfter } from '../model'

/** Document snapshots own task identity; newer observations may refresh the same task. */
export function resolveDocumentTask(
  document: LogicalDocument,
  snapshot?: DocumentProcessingTask,
  submittedTaskId?: string,
): DocumentProcessingTask | undefined {
  const taskId = submittedTaskId ?? document.latestTask?.id
  if (!taskId) return undefined
  const matches = (task: DocumentProcessingTask | undefined) =>
    task?.id === taskId &&
    task.documentId === document.id &&
    task.knowledgeSpaceId === document.knowledgeSpaceId
  const embedded = matches(document.latestTask) ? document.latestTask : undefined
  const observed = matches(snapshot) ? snapshot : undefined
  const task =
    observed && (!embedded || !taskVersionIsAfter(embedded.updatedAt, observed.updatedAt))
      ? observed
      : embedded
  const activeRevision = document.activeRevision ?? document.active?.revision ?? 0
  return task && (submittedTaskId || task.documentRevision >= activeRevision) ? task : undefined
}

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
