'use client'

import { atom } from 'jotai'
import {
  atomWithStorage,
  createJSONStorage,
  unstable_withStorageValidator as withStorageValidator,
} from 'jotai/utils'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'

type BackgroundTaskDismissals = Record<string, string[]>

const BACKGROUND_TASK_DISMISSALS_STORAGE_KEY = 'dify-new-knowledge-background-task-dismissals'
const EMPTY_DISMISSALS: BackgroundTaskDismissals = {}
const MAX_DISMISSALS_PER_SPACE = 500

function isBackgroundTaskDismissals(value: unknown): value is BackgroundTaskDismissals {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (taskIds) => Array.isArray(taskIds) && taskIds.every((taskId) => typeof taskId === 'string'),
    ),
  )
}

const backgroundTaskDismissalsStorage = withStorageValidator(isBackgroundTaskDismissals)(
  createJSONStorage<unknown>(),
)

const backgroundTaskDismissalsAtom = atomWithStorage<BackgroundTaskDismissals>(
  BACKGROUND_TASK_DISMISSALS_STORAGE_KEY,
  EMPTY_DISMISSALS,
  backgroundTaskDismissalsStorage,
)

export const dismissedBackgroundTaskIdsAtom = atom((get) => {
  const knowledgeSpaceId = get(documentsKnowledgeSpaceIdAtom)
  return new Set(get(backgroundTaskDismissalsAtom)[knowledgeSpaceId] ?? [])
})

export const dismissBackgroundTaskAtom = atom(null, (get, set, taskId: string) => {
  const knowledgeSpaceId = get(documentsKnowledgeSpaceIdAtom)
  set(backgroundTaskDismissalsAtom, (current) => {
    const taskIds = current[knowledgeSpaceId] ?? []
    if (taskIds.includes(taskId)) return current

    return {
      ...current,
      [knowledgeSpaceId]: [taskId, ...taskIds].slice(0, MAX_DISMISSALS_PER_SPACE),
    }
  })
})

export const restoreBackgroundTaskAtom = atom(null, (get, set, taskId: string) => {
  const knowledgeSpaceId = get(documentsKnowledgeSpaceIdAtom)
  set(backgroundTaskDismissalsAtom, (current) => {
    const taskIds = current[knowledgeSpaceId]
    if (!taskIds?.includes(taskId)) return current

    const nextTaskIds = taskIds.filter((id) => id !== taskId)
    if (nextTaskIds.length) return { ...current, [knowledgeSpaceId]: nextTaskIds }

    const { [knowledgeSpaceId]: _removed, ...rest } = current
    return rest
  })
})
