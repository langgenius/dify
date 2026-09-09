import { atom } from 'jotai'
import { taskIsActive } from '../model'
import { backgroundTasksAtom, baseTasksAtom } from '../state/queries'
import { taskRuntimeStateAtom } from '../state/scoped'
import { transitionTaskRuntimeState } from './runtime-state'
import { effectiveDocumentTasks } from './snapshot'
import { dismissedBackgroundTaskIdsAtom } from './storage'

export const applyTaskRuntimeEventAtom = atom(
  null,
  (get, set, event: Parameters<typeof transitionTaskRuntimeState>[1]) => {
    const transition = transitionTaskRuntimeState(get(taskRuntimeStateAtom), event)
    let state = transition.state
    const tasks = effectiveDocumentTasks({
      baseTasks: get(baseTasksAtom),
      streamActiveOverrideVersions: state.streamActiveOverrideVersions,
      taskOverrides: state.overrides,
      terminalTaskPins: state.terminalPins,
    })
    for (const task of tasks) {
      if (!taskIsActive(task))
        state = transitionTaskRuntimeState(state, { taskId: task.id, type: 'task-inactive' }).state
    }
    set(taskRuntimeStateAtom, state)
    return { ...transition, state }
  },
)

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
