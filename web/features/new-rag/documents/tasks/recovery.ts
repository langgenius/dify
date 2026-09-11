import type { DocumentProcessingTask } from '../models'
import { consoleClient } from '@/service/console'
import { documentTaskFromApi } from '../models'
import { responseStatus } from '../request-error'

export const TASK_PAGE_SIZE = 100
export const MAX_AUTO_CURSOR_PAGES = 20

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
  const ids = [...taskIds]
  const tasks = new Map<string, DocumentProcessingTask>()
  for (let offset = 0; offset < ids.length; offset += TASK_PAGE_SIZE) {
    signal?.throwIfAborted()
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get(
      {
        params: { control_space_id: knowledgeSpaceId },
        query: { task_ids: ids.slice(offset, offset + TASK_PAGE_SIZE).join(',') },
      },
      { signal, context: { silent: true } },
    )
    for (const candidate of response.data) {
      if (!taskIds.has(candidate.id)) continue
      const task = documentTaskFromApi(candidate)
      if (task) tasks.set(task.id, task)
    }
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
