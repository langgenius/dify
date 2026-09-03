import { atom } from 'jotai'
import { taskIsActive } from '../model'
import { backgroundTasksAtom, baseTasksAtom } from '../state/queries'
import { taskRuntimeStateAtom } from '../state/scoped'
import { effectiveDocumentTasks } from './snapshot'
import { dismissedBackgroundTaskIdsAtom } from './storage'

export const effectiveTasksAtom = atom((get) => {
  const runtimeState = get(taskRuntimeStateAtom)

  return effectiveDocumentTasks({
    baseTasks: get(baseTasksAtom),
    streamActiveOverrideVersions: runtimeState.streamActiveOverrideVersions,
    taskOverrides: runtimeState.overrides,
    terminalTaskPins: runtimeState.terminalPins,
  })
})

export const activeTasksAtom = atom((get) => get(effectiveTasksAtom).filter(taskIsActive))

export const drawerTasksAtom = atom((get) => {
  const effectiveTaskById = new Map(get(effectiveTasksAtom).map((task) => [task.id, task]))
  const dismissedTaskIds = get(dismissedBackgroundTaskIdsAtom)

  return get(backgroundTasksAtom)
    .map((task) => effectiveTaskById.get(task.id) ?? task)
    .filter((task) => taskIsActive(task) || !dismissedTaskIds.has(task.id))
})
