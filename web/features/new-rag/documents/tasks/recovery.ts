import type { DocumentProcessingTask } from '../../document-models'
import { consoleClient } from '@/service/client'
import { documentTaskFromApi } from '../../document-models'
import { responseStatus } from '../request-error'

export const TASK_PAGE_SIZE = 100
export const MAX_AUTO_CURSOR_PAGES = 20

export type TerminalTaskPin = {
  observedAt: string
  taskListGeneration: number
}

export type TrustedActiveOverride = {
  taskListGeneration: number
  updatedAt: string
}

export type AuxiliaryTaskReadDenial = {
  taskListGeneration: number
  taskVersion: string
}

export async function findBackgroundTask(
  knowledgeSpaceId: string,
  taskId: string,
  signal?: AbortSignal,
) {
  return (await findBackgroundTasks(knowledgeSpaceId, new Set([taskId]), signal)).get(taskId)
}

export async function findBackgroundTasks(
  knowledgeSpaceId: string,
  taskIds: ReadonlySet<string>,
  signal?: AbortSignal,
) {
  const remainingTaskIds = new Set(taskIds)
  const tasks = new Map<string, DocumentProcessingTask>()
  if (!remainingTaskIds.size) return tasks
  let cursor: string | undefined
  for (let page = 0; page < MAX_AUTO_CURSOR_PAGES; page += 1) {
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get(
      {
        params: { control_space_id: knowledgeSpaceId },
        query: { ...(cursor ? { cursor } : {}), limit: TASK_PAGE_SIZE },
      },
      { signal },
    )
    for (const candidate of response.data) {
      if (!remainingTaskIds.has(candidate.id)) continue
      const task = documentTaskFromApi(candidate)
      if (!task) continue
      tasks.set(task.id, task)
      remainingTaskIds.delete(task.id)
    }
    if (!remainingTaskIds.size) return tasks
    cursor = response.next_cursor ?? undefined
    if (!cursor) return tasks
  }
  return tasks
}

export function taskSnapshotErrorIsTransient(error: unknown) {
  const status = responseStatus(error)
  return status === undefined || status === 408 || status === 429 || status >= 500
}

export function queryKeyMatchesKnowledgeSpace(
  queryKey: readonly unknown[],
  knowledgeSpaceId: string,
) {
  const state = queryKey[1]
  if (!state || typeof state !== 'object' || !('input' in state)) return false
  const input = state.input
  if (!input || typeof input !== 'object' || !('params' in input)) return false
  const params = input.params
  return Boolean(
    params &&
    typeof params === 'object' &&
    'control_space_id' in params &&
    params.control_space_id === knowledgeSpaceId,
  )
}

export function normalizedTaskSnapshot(task: DocumentProcessingTask): DocumentProcessingTask {
  return {
    ...task,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
  }
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
