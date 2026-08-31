import type { DocumentProcessingTask } from '../models'
import type { ProcessingTaskEvent, ProcessingTaskProgressEvent } from './events'
import type { TrustedActiveOverride } from './recovery'
import type { TerminalTaskPin } from './snapshot'
import { ACTIVE_TASK_STATES, taskIsActive, taskVersionIsAfter } from '../model'

export type TaskRuntimeState = {
  currentStates: ReadonlyMap<string, DocumentProcessingTask['state']>
  currentVersions: ReadonlyMap<string, string>
  eventCursors: ReadonlyMap<string, string>
  listGeneration: number
  observerGenerations: Readonly<Record<string, number>>
  overrides: Readonly<Record<string, Partial<DocumentProcessingTask>>>
  pendingTerminalProgress: ReadonlyMap<string, ProcessingTaskProgressEvent>
  streamActiveOverrideVersions: ReadonlyMap<string, string>
  terminalPins: Readonly<Record<string, TerminalTaskPin>>
  trustedActiveOverrides: ReadonlyMap<string, TrustedActiveOverride>
  trustedOverrideListGenerations: ReadonlyMap<string, number>
}

export type TaskRuntimeEvent =
  | { tasks: readonly DocumentProcessingTask[]; type: 'list-snapshot' }
  | {
      restartObserver?: boolean
      task: DocumentProcessingTask
      type: 'task-snapshot'
    }
  | {
      event: ProcessingTaskEvent
      taskId: string
      taskVersion: string
      type: 'stream-event'
    }
  | { eventId?: string; taskId: string; type: 'event-cursor' }
  | { generation: number; taskId: string; type: 'trusted-override-checked' }
  | { taskId: string; type: 'task-inactive' }
  | { task: DocumentProcessingTask; type: 'terminal-confirmed' }
  | { task: DocumentProcessingTask; type: 'retry-confirmed' }
  | { taskId: string; type: 'restart-observer' }

export type TaskRuntimeTransition = {
  accepted?: boolean
  state: TaskRuntimeState
  terminal?: {
    state: Extract<
      DocumentProcessingTask['state'],
      'canceled' | 'failed' | 'succeeded' | 'superseded'
    >
    version: string
  }
}

export function createTaskRuntimeState(
  tasks: readonly DocumentProcessingTask[] = [],
): TaskRuntimeState {
  return {
    currentStates: new Map(tasks.map((task) => [task.id, task.state])),
    currentVersions: new Map(tasks.map((task) => [task.id, task.updatedAt])),
    eventCursors: new Map(),
    listGeneration: 0,
    observerGenerations: {},
    overrides: {},
    pendingTerminalProgress: new Map(),
    streamActiveOverrideVersions: new Map(),
    terminalPins: {},
    trustedActiveOverrides: new Map(),
    trustedOverrideListGenerations: new Map(),
  }
}

function retainMap<Value>(source: ReadonlyMap<string, Value>, taskIds: ReadonlySet<string>) {
  return new Map([...source].filter(([taskId]) => taskIds.has(taskId)))
}

function retainRecord<Value>(
  source: Readonly<Record<string, Value>>,
  taskIds: ReadonlySet<string>,
) {
  return Object.fromEntries(Object.entries(source).filter(([taskId]) => taskIds.has(taskId)))
}

function listSnapshot(
  state: TaskRuntimeState,
  tasks: readonly DocumentProcessingTask[],
): TaskRuntimeState {
  const taskIds = new Set(tasks.map((task) => task.id))
  const currentStates = retainMap(state.currentStates, taskIds)
  const currentVersions = retainMap(state.currentVersions, taskIds)
  const eventCursors = retainMap(state.eventCursors, taskIds)
  const pendingTerminalProgress = retainMap(state.pendingTerminalProgress, taskIds)
  const streamActiveOverrideVersions = retainMap(state.streamActiveOverrideVersions, taskIds)
  const trustedActiveOverrides = retainMap(state.trustedActiveOverrides, taskIds)
  const trustedOverrideListGenerations = retainMap(state.trustedOverrideListGenerations, taskIds)

  for (const task of tasks) {
    const currentVersion = currentVersions.get(task.id)
    if (!currentVersion || !taskVersionIsAfter(currentVersion, task.updatedAt)) {
      currentStates.set(task.id, task.state)
      currentVersions.set(task.id, task.updatedAt)
    }
  }

  return {
    ...state,
    currentStates,
    currentVersions,
    eventCursors,
    listGeneration: state.listGeneration + 1,
    observerGenerations: retainRecord(state.observerGenerations, taskIds),
    overrides: retainRecord(state.overrides, taskIds),
    pendingTerminalProgress,
    streamActiveOverrideVersions,
    terminalPins: retainRecord(state.terminalPins, taskIds),
    trustedActiveOverrides,
    trustedOverrideListGenerations,
  }
}

function taskSnapshot(
  state: TaskRuntimeState,
  task: DocumentProcessingTask,
  restartObserver = false,
): TaskRuntimeTransition {
  const currentVersion = state.currentVersions.get(task.id)
  if (currentVersion && taskVersionIsAfter(currentVersion, task.updatedAt))
    return { accepted: false, state }

  const currentStates = new Map(state.currentStates).set(task.id, task.state)
  const currentVersions = new Map(state.currentVersions).set(task.id, task.updatedAt)
  const streamActiveOverrideVersions = new Map(state.streamActiveOverrideVersions)
  streamActiveOverrideVersions.delete(task.id)
  const trustedActiveOverrides = new Map(state.trustedActiveOverrides)
  const trustedOverrideListGenerations = new Map(state.trustedOverrideListGenerations)
  trustedOverrideListGenerations.delete(task.id)
  if (taskIsActive(task))
    trustedActiveOverrides.set(task.id, {
      taskListGeneration: state.listGeneration,
      updatedAt: task.updatedAt,
    })
  else trustedActiveOverrides.delete(task.id)

  const pendingTerminalProgress = new Map(state.pendingTerminalProgress)
  const eventCursors = new Map(state.eventCursors)
  const terminalPins = { ...state.terminalPins }
  let observerGenerations = state.observerGenerations
  if (taskIsActive(task)) {
    pendingTerminalProgress.delete(task.id)
    eventCursors.delete(task.id)
    delete terminalPins[task.id]
    if (restartObserver)
      observerGenerations = {
        ...observerGenerations,
        [task.id]: (observerGenerations[task.id] ?? 0) + 1,
      }
  }

  return {
    accepted: true,
    state: {
      ...state,
      currentStates,
      currentVersions,
      eventCursors,
      observerGenerations,
      overrides: { ...state.overrides, [task.id]: task },
      pendingTerminalProgress,
      streamActiveOverrideVersions,
      terminalPins,
      trustedActiveOverrides,
      trustedOverrideListGenerations,
    },
  }
}

function streamEvent(
  state: TaskRuntimeState,
  taskId: string,
  taskVersion: string,
  event: ProcessingTaskEvent,
): TaskRuntimeTransition {
  const eventVersion = event.event === 'progress' ? event.data.updatedAt : taskVersion
  const terminalSnapshot = !ACTIVE_TASK_STATES.has(event.data.state)
  const currentVersion = state.currentVersions.get(taskId)
  if (currentVersion && taskVersionIsAfter(currentVersion, eventVersion)) {
    if (!terminalSnapshot) return { accepted: false, state }
    const pendingTerminalProgress = new Map(state.pendingTerminalProgress)
    pendingTerminalProgress.delete(taskId)
    return { accepted: false, state: { ...state, pendingTerminalProgress } }
  }

  const currentVersions = new Map(state.currentVersions).set(taskId, eventVersion)
  const streamActiveOverrideVersions = new Map(state.streamActiveOverrideVersions)
  if (event.event === 'progress' && ACTIVE_TASK_STATES.has(event.data.state)) {
    if (state.trustedActiveOverrides.get(taskId)?.updatedAt === eventVersion)
      streamActiveOverrideVersions.delete(taskId)
    else streamActiveOverrideVersions.set(taskId, eventVersion)
  } else streamActiveOverrideVersions.delete(taskId)

  const pendingTerminalProgress = new Map(state.pendingTerminalProgress)
  if (event.event === 'progress' && terminalSnapshot) {
    pendingTerminalProgress.set(taskId, event)
    return {
      accepted: true,
      state: {
        ...state,
        currentVersions,
        pendingTerminalProgress,
        streamActiveOverrideVersions,
      },
    }
  }

  const currentStates = new Map(state.currentStates)
  const currentTaskState = currentStates.get(taskId)
  currentStates.set(taskId, event.data.state)
  const pendingProgress =
    event.event === 'terminal' ? pendingTerminalProgress.get(taskId) : undefined
  if (event.event === 'terminal') pendingTerminalProgress.delete(taskId)

  if (event.event === 'progress' && currentTaskState === event.data.state)
    return {
      accepted: true,
      state: {
        ...state,
        currentStates,
        currentVersions,
        pendingTerminalProgress,
        streamActiveOverrideVersions,
      },
    }

  const previous = state.overrides[taskId]
  if (
    event.event === 'progress' &&
    previous?.updatedAt &&
    taskVersionIsAfter(previous.updatedAt, event.data.updatedAt)
  )
    return { accepted: true, state }

  const override: Partial<DocumentProcessingTask> =
    event.event === 'progress'
      ? {
          errorCode: undefined,
          errorMessage: undefined,
          failure: undefined,
          progressPercent: event.data.progressPercent,
          stage: event.data.stage,
          state: event.data.state,
          updatedAt: event.data.updatedAt,
        }
      : {
          errorCode: event.data.errorCode,
          errorMessage: undefined,
          failure: event.data.failure,
          ...(pendingProgress
            ? {
                progressPercent: pendingProgress.data.progressPercent,
                stage: pendingProgress.data.stage,
              }
            : {}),
          state: event.data.state,
          updatedAt: eventVersion,
        }

  const terminalPins = { ...state.terminalPins }
  if (event.event === 'terminal')
    terminalPins[taskId] = {
      observedAt: eventVersion,
      taskListGeneration: state.listGeneration,
    }

  return {
    accepted: true,
    state: {
      ...state,
      currentStates,
      currentVersions,
      overrides: { ...state.overrides, [taskId]: override },
      pendingTerminalProgress,
      streamActiveOverrideVersions,
      terminalPins,
    },
    ...(event.event === 'terminal'
      ? { terminal: { state: event.data.state, version: eventVersion } }
      : {}),
  }
}

function retireSnapshot(
  state: TaskRuntimeState,
  task: DocumentProcessingTask,
  retry: boolean,
): TaskRuntimeState {
  const terminalPins = { ...state.terminalPins }
  delete terminalPins[task.id]
  const overrides = { ...state.overrides }
  const overrideVersion = overrides[task.id]?.updatedAt
  if (!overrideVersion || !taskVersionIsAfter(overrideVersion, task.updatedAt))
    delete overrides[task.id]

  if (!retry) return { ...state, overrides, terminalPins }
  const eventCursors = new Map(state.eventCursors)
  eventCursors.delete(task.id)
  const pendingTerminalProgress = new Map(state.pendingTerminalProgress)
  pendingTerminalProgress.delete(task.id)
  return { ...state, eventCursors, overrides, pendingTerminalProgress, terminalPins }
}

export function transitionTaskRuntimeState(
  state: TaskRuntimeState,
  event: TaskRuntimeEvent,
): TaskRuntimeTransition {
  switch (event.type) {
    case 'list-snapshot':
      return { state: listSnapshot(state, event.tasks) }
    case 'task-snapshot':
      return taskSnapshot(state, event.task, event.restartObserver)
    case 'stream-event':
      return streamEvent(state, event.taskId, event.taskVersion, event.event)
    case 'event-cursor': {
      const eventCursors = new Map(state.eventCursors)
      if (event.eventId) eventCursors.set(event.taskId, event.eventId)
      else eventCursors.delete(event.taskId)
      return { state: { ...state, eventCursors } }
    }
    case 'trusted-override-checked':
      return {
        state: {
          ...state,
          trustedOverrideListGenerations: new Map(state.trustedOverrideListGenerations).set(
            event.taskId,
            event.generation,
          ),
        },
      }
    case 'task-inactive': {
      if (
        !state.eventCursors.has(event.taskId) &&
        !state.streamActiveOverrideVersions.has(event.taskId) &&
        !state.trustedActiveOverrides.has(event.taskId) &&
        !state.trustedOverrideListGenerations.has(event.taskId)
      )
        return { state }
      const eventCursors = new Map(state.eventCursors)
      const streamActiveOverrideVersions = new Map(state.streamActiveOverrideVersions)
      const trustedActiveOverrides = new Map(state.trustedActiveOverrides)
      const trustedOverrideListGenerations = new Map(state.trustedOverrideListGenerations)
      eventCursors.delete(event.taskId)
      streamActiveOverrideVersions.delete(event.taskId)
      trustedActiveOverrides.delete(event.taskId)
      trustedOverrideListGenerations.delete(event.taskId)
      return {
        state: {
          ...state,
          eventCursors,
          streamActiveOverrideVersions,
          trustedActiveOverrides,
          trustedOverrideListGenerations,
        },
      }
    }
    case 'terminal-confirmed':
      return { state: retireSnapshot(state, event.task, false) }
    case 'retry-confirmed':
      return { state: retireSnapshot(state, event.task, true) }
    case 'restart-observer':
      return {
        state: {
          ...state,
          observerGenerations: {
            ...state.observerGenerations,
            [event.taskId]: (state.observerGenerations[event.taskId] ?? 0) + 1,
          },
        },
      }
  }
}
