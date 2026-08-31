'use client'

import type { BackgroundTask, DocumentProcessingTask } from '../models'
import type { AuxiliaryTaskReadGuard } from './auxiliary-read-guard'
import type { ProcessingTaskEvent } from './events'
import type { AuxiliaryTaskReadDenial } from './recovery'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { taskIsActive, taskVersionIsAfter } from '../model'
import { backgroundTaskListFromApi, documentTaskListFromApi } from '../models'
import { documentTasksInfiniteOptions } from '../queries'
import { responseStatus } from '../request-error'
import { useQueryDataUpdateCount } from '../use-query-data-update-count'
import { createTaskProgressStore } from './progress-store'
import { findBackgroundTask, findBackgroundTasks, taskSnapshotErrorIsTransient } from './recovery'
import { createTaskRuntimeState, transitionTaskRuntimeState } from './runtime-state'
import { effectiveDocumentTasks, mergeTaskOverride } from './snapshot'

const MAX_TASK_EVENT_STREAMS = 6
const FAILED_TASK_POLL_REQUEST_TIMEOUT = 3000
const TERMINAL_RECONCILIATION_REQUEST_TIMEOUT = 3000
const BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL = 5000
const MAX_BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL = 30000

type UseTaskRuntimeOptions = {
  auxiliaryTaskReadGuard: AuxiliaryTaskReadGuard
  denyAuxiliaryTaskRead: (taskId: string, taskVersion: string) => void
  documentPermissionDenied: boolean
  externalPermissionDenied: boolean
  knowledgeSpaceId: string
  onTaskFailed: () => void
  onTaskReachedTerminal: () => void
  tasksOpen: boolean
}

export function useTaskRuntime({
  auxiliaryTaskReadGuard,
  denyAuxiliaryTaskRead,
  documentPermissionDenied,
  externalPermissionDenied,
  knowledgeSpaceId,
  onTaskFailed,
  onTaskReachedTerminal,
  tasksOpen,
}: UseTaskRuntimeOptions) {
  const queryClient = useQueryClient()
  const tasksQueryOptions = useMemo(
    () => documentTasksInfiniteOptions(knowledgeSpaceId, { enabled: !documentPermissionDenied }),
    [documentPermissionDenied, knowledgeSpaceId],
  )
  const tasksQuery = useInfiniteQuery(tasksQueryOptions)
  const baseTasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((page) => documentTaskListFromApi(page).items) ?? [],
    [tasksQuery.data],
  )
  const backgroundTasks = useMemo<BackgroundTask[]>(
    () => tasksQuery.data?.pages.flatMap((page) => backgroundTaskListFromApi(page).items) ?? [],
    [tasksQuery.data],
  )
  const taskDataUpdateCount = useQueryDataUpdateCount(queryClient, tasksQueryOptions.queryKey)
  const listSnapshot = useMemo(
    () => ({
      data: tasksQuery.data,
      dataUpdateCount: taskDataUpdateCount,
      dataUpdatedAt: tasksQuery.dataUpdatedAt,
    }),
    [taskDataUpdateCount, tasksQuery.data, tasksQuery.dataUpdatedAt],
  )
  const taskPermissionDenied = responseStatus(tasksQuery.error) === 403
  const permissionDenied = externalPermissionDenied || taskPermissionDenied
  const refetchTasks = tasksQuery.refetch

  const runtimeStateRef = useRef(createTaskRuntimeState())
  const [runtimeState, dispatchRuntimeEvent] = useReducer(
    (state, event: Parameters<typeof transitionTaskRuntimeState>[1]) =>
      transitionTaskRuntimeState(state, event).state,
    runtimeStateRef.current,
  )
  useLayoutEffect(() => {
    runtimeStateRef.current = runtimeState
  }, [runtimeState])
  const applyRuntimeEvent = useCallback(
    (event: Parameters<typeof transitionTaskRuntimeState>[1]) => {
      const transition = transitionTaskRuntimeState(runtimeStateRef.current, event)
      runtimeStateRef.current = transition.state
      dispatchRuntimeEvent(event)
      return transition
    },
    [],
  )

  const taskProgressStoreRef = useRef<ReturnType<typeof createTaskProgressStore> | null>(null)
  if (!taskProgressStoreRef.current) taskProgressStoreRef.current = createTaskProgressStore()
  const taskProgressStore = taskProgressStoreRef.current
  const taskListSnapshotRef = useRef<typeof listSnapshot | null>(null)
  useLayoutEffect(() => {
    if (
      taskListSnapshotRef.current?.dataUpdateCount === listSnapshot.dataUpdateCount &&
      taskListSnapshotRef.current.dataUpdatedAt === listSnapshot.dataUpdatedAt &&
      taskListSnapshotRef.current.data === listSnapshot.data
    )
      return
    taskListSnapshotRef.current = listSnapshot
    applyRuntimeEvent({ tasks: baseTasks, type: 'list-snapshot' })
  }, [applyRuntimeEvent, baseTasks, listSnapshot])

  const baseTaskByIdRef = useRef(new Map(baseTasks.map((task) => [task.id, task])))
  useLayoutEffect(() => {
    baseTaskByIdRef.current = new Map(baseTasks.map((task) => [task.id, task]))
  }, [baseTasks])

  const terminalReconciliationGenerationsRef = useRef(new Map<string, number>())
  const terminalReconciliationTimeoutsRef = useRef(new Map<string, number>())
  const terminalReconciliationControllersRef = useRef(new Map<string, AbortController>())
  const failedTaskPollGenerationsRef = useRef(new Map<string, number>())
  const blockedFailedTaskPollVersionsRef = useRef(new Map<string, string>())
  const failedPollAuxiliaryDenialsRef = useRef(new Map<string, AuxiliaryTaskReadDenial>())
  const terminalConfirmableAuxiliaryDenialsRef = useRef(new Map<string, AuxiliaryTaskReadDenial>())
  const equalRetryListGenerationsRef = useRef(new Map<string, number>())
  const failedTaskPollOffsetRef = useRef(0)
  const [taskStreamOffset, setTaskStreamOffset] = useState(0)
  const listedBackgroundTaskStatesRef = useRef<{
    knowledgeSpaceId: string
    states: Map<string, string>
  }>({ knowledgeSpaceId, states: new Map() })

  const tasks = useMemo(
    () =>
      effectiveDocumentTasks({
        baseTasks,
        streamActiveOverrideVersions: runtimeState.streamActiveOverrideVersions,
        taskOverrides: runtimeState.overrides,
        terminalTaskPins: runtimeState.terminalPins,
      }),
    [
      baseTasks,
      runtimeState.overrides,
      runtimeState.streamActiveOverrideVersions,
      runtimeState.terminalPins,
    ],
  )
  const effectiveTaskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const drawerTasks = useMemo(
    () => backgroundTasks.map((task) => effectiveTaskById.get(task.id) ?? task),
    [backgroundTasks, effectiveTaskById],
  )
  const activeTasks = useMemo(() => tasks.filter(taskIsActive), [tasks])
  useEffect(() => {
    for (const task of tasks) {
      if (!taskIsActive(task)) applyRuntimeEvent({ taskId: task.id, type: 'task-inactive' })
    }
  }, [applyRuntimeEvent, tasks])
  const orderedActiveTasks = useMemo(
    () =>
      [...activeTasks].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
    [activeTasks],
  )
  const orderedFailedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.state === 'failed')
        .sort((left, right) => {
          if (taskVersionIsAfter(left.updatedAt, right.updatedAt)) return -1
          if (taskVersionIsAfter(right.updatedAt, left.updatedAt)) return 1
          return right.id.localeCompare(left.id)
        }),
    [tasks],
  )
  const orderedFailedTasksRef = useRef(orderedFailedTasks)
  useLayoutEffect(() => {
    orderedFailedTasksRef.current = orderedFailedTasks
  }, [orderedFailedTasks])

  const observerVersion = useCallback(
    (task: DocumentProcessingTask) => {
      let latestVersion = task.updatedAt
      for (const candidate of [
        runtimeStateRef.current.currentVersions.get(task.id),
        taskProgressStore.get(task.id)?.updatedAt,
      ]) {
        if (candidate && taskVersionIsAfter(candidate, latestVersion)) latestVersion = candidate
      }
      return latestVersion
    },
    [taskProgressStore],
  )
  const streamableActiveTasks = orderedActiveTasks.filter(
    (task) => !auxiliaryTaskReadGuard.isBlocked(task.id, observerVersion(task)),
  )
  const streamCount = permissionDenied
    ? 0
    : Math.min(MAX_TASK_EVENT_STREAMS, streamableActiveTasks.length)
  const streamOffset = streamableActiveTasks.length
    ? taskStreamOffset % streamableActiveTasks.length
    : 0
  const streamedActiveTasks = Array.from(
    { length: streamCount },
    (_, index) => streamableActiveTasks[(streamOffset + index) % streamableActiveTasks.length]!,
  )
  const blockedActiveTaskSignature = orderedActiveTasks
    .map((task) => [task.id, observerVersion(task)] as const)
    .filter(([taskId, taskVersion]) => auxiliaryTaskReadGuard.isBlocked(taskId, taskVersion))
    .map(([taskId, taskVersion]) => `${taskId}:${taskVersion}`)
    .join('|')
  const failedTaskPollSignature = orderedFailedTasks
    .map((task) => `${task.id}:${task.updatedAt}`)
    .join('|')

  useEffect(() => {
    const previousStates =
      listedBackgroundTaskStatesRef.current.knowledgeSpaceId === knowledgeSpaceId
        ? listedBackgroundTaskStatesRef.current.states
        : new Map<string, string>()
    const states = new Map<string, string>()
    let documentTaskReachedTerminal = false
    for (const task of backgroundTasks) {
      states.set(task.id, task.state)
      const previousState = previousStates.get(task.id)
      if (
        (previousState === 'queued' || previousState === 'running') &&
        task.state !== 'queued' &&
        task.state !== 'running' &&
        (task.taskKind === 'document' || task.taskKind === 'document_bulk')
      )
        documentTaskReachedTerminal = true
    }
    listedBackgroundTaskStatesRef.current = { knowledgeSpaceId, states }
    if (documentTaskReachedTerminal) onTaskReachedTerminal()
  }, [backgroundTasks, knowledgeSpaceId, onTaskReachedTerminal])

  useEffect(() => {
    if (permissionDenied || orderedActiveTasks.length <= MAX_TASK_EVENT_STREAMS) return
    const interval = window.setInterval(
      () => setTaskStreamOffset((current) => current + MAX_TASK_EVENT_STREAMS),
      5000,
    )
    return () => window.clearInterval(interval)
  }, [orderedActiveTasks.length, permissionDenied])

  useEffect(() => {
    if (permissionDenied || !blockedActiveTaskSignature) return
    let canceled = false
    let refreshInterval = BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL
    let timeout: number | undefined
    const refreshBlockedTasks = async () => {
      if (canceled) return
      await refetchTasks({ cancelRefetch: false }).catch(() => undefined)
      if (canceled) return
      refreshInterval = Math.min(refreshInterval * 2, MAX_BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL)
      timeout = window.setTimeout(refreshBlockedTasks, refreshInterval)
    }
    timeout = window.setTimeout(refreshBlockedTasks, BLOCKED_ACTIVE_TASK_REFRESH_INTERVAL)
    return () => {
      canceled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [blockedActiveTaskSignature, permissionDenied, refetchTasks])

  const cancelTerminalReconciliation = useCallback((taskId: string) => {
    terminalReconciliationControllersRef.current.get(taskId)?.abort()
    terminalReconciliationControllersRef.current.delete(taskId)
    const timeout = terminalReconciliationTimeoutsRef.current.get(taskId)
    if (timeout !== undefined) window.clearTimeout(timeout)
    terminalReconciliationTimeoutsRef.current.delete(taskId)
  }, [])

  useEffect(() => {
    if (!permissionDenied) return
    for (const taskId of terminalReconciliationControllersRef.current.keys())
      cancelTerminalReconciliation(taskId)
    for (const timeout of terminalReconciliationTimeoutsRef.current.values())
      window.clearTimeout(timeout)
    terminalReconciliationTimeoutsRef.current.clear()
    equalRetryListGenerationsRef.current.clear()
  }, [cancelTerminalReconciliation, permissionDenied])

  const reconcileTerminalTask = useCallback(
    async function reconcileTerminalTaskRequest(
      taskId: string,
      terminalVersion: string,
      reconciliationGeneration: number,
      retryAttempt = 0,
    ) {
      const currentTask = baseTaskByIdRef.current.get(taskId)
      if (!currentTask || auxiliaryTaskReadGuard.isBlocked(taskId, terminalVersion)) return
      cancelTerminalReconciliation(taskId)
      const controller = new AbortController()
      terminalReconciliationControllersRef.current.set(taskId, controller)
      const requestTimeout = window.setTimeout(
        () => controller.abort(),
        TERMINAL_RECONCILIATION_REQUEST_TIMEOUT,
      )
      try {
        const snapshot = await findBackgroundTask(knowledgeSpaceId, taskId, controller.signal)
        if (!snapshot) return
        if (
          terminalReconciliationControllersRef.current.get(taskId) !== controller ||
          terminalReconciliationGenerationsRef.current.get(taskId) !== reconciliationGeneration
        )
          return
        terminalReconciliationControllersRef.current.delete(taskId)
        const currentTaskVersion = runtimeStateRef.current.currentVersions.get(taskId)
        if (currentTaskVersion && taskVersionIsAfter(currentTaskVersion, snapshot.updatedAt)) return
        if (taskVersionIsAfter(terminalVersion, snapshot.updatedAt)) return
        auxiliaryTaskReadGuard.clearTask(taskId)
        failedPollAuxiliaryDenialsRef.current.delete(taskId)
        terminalConfirmableAuxiliaryDenialsRef.current.delete(taskId)
        taskProgressStore.delete(taskId)
        const transition = applyRuntimeEvent({
          restartObserver: taskIsActive(snapshot),
          task: snapshot,
          type: 'task-snapshot',
        })
        if (transition.accepted && taskIsActive(snapshot)) {
          blockedFailedTaskPollVersionsRef.current.delete(taskId)
          failedTaskPollGenerationsRef.current.set(
            taskId,
            (failedTaskPollGenerationsRef.current.get(taskId) ?? 0) + 1,
          )
        }
      } catch (error) {
        if (terminalReconciliationControllersRef.current.get(taskId) !== controller) return
        terminalReconciliationControllersRef.current.delete(taskId)
        if (responseStatus(error) === 403) {
          const currentTaskVersion = runtimeStateRef.current.currentVersions.get(taskId)
          const deniedVersion =
            currentTaskVersion && taskVersionIsAfter(currentTaskVersion, terminalVersion)
              ? currentTaskVersion
              : terminalVersion
          terminalConfirmableAuxiliaryDenialsRef.current.set(taskId, {
            taskListGeneration: runtimeStateRef.current.listGeneration,
            taskVersion: deniedVersion,
          })
          denyAuxiliaryTaskRead(taskId, deniedVersion)
          return
        }
        if (
          retryAttempt >= 4 ||
          !taskSnapshotErrorIsTransient(error) ||
          terminalReconciliationGenerationsRef.current.get(taskId) !== reconciliationGeneration
        )
          return
        const timeout = window.setTimeout(
          () => {
            terminalReconciliationTimeoutsRef.current.delete(taskId)
            if (
              terminalReconciliationGenerationsRef.current.get(taskId) === reconciliationGeneration
            )
              void reconcileTerminalTaskRequest(
                taskId,
                terminalVersion,
                reconciliationGeneration,
                retryAttempt + 1,
              )
          },
          Math.min(1000 * 2 ** retryAttempt, 30000),
        )
        terminalReconciliationTimeoutsRef.current.set(taskId, timeout)
      } finally {
        window.clearTimeout(requestTimeout)
      }
    },
    [
      applyRuntimeEvent,
      auxiliaryTaskReadGuard,
      cancelTerminalReconciliation,
      denyAuxiliaryTaskRead,
      knowledgeSpaceId,
      taskProgressStore,
    ],
  )

  const acceptTaskSnapshot = useCallback(
    (task: DocumentProcessingTask) => {
      const transition = applyRuntimeEvent({ task, type: 'task-snapshot' })
      if (!transition.accepted) return false
      auxiliaryTaskReadGuard.clearTask(task.id)
      failedPollAuxiliaryDenialsRef.current.delete(task.id)
      terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
      taskProgressStore.delete(task.id)
      if (taskIsActive(task)) {
        blockedFailedTaskPollVersionsRef.current.delete(task.id)
        cancelTerminalReconciliation(task.id)
        terminalReconciliationGenerationsRef.current.set(
          task.id,
          (terminalReconciliationGenerationsRef.current.get(task.id) ?? 0) + 1,
        )
        failedTaskPollGenerationsRef.current.set(
          task.id,
          (failedTaskPollGenerationsRef.current.get(task.id) ?? 0) + 1,
        )
      }
      return true
    },
    [applyRuntimeEvent, auxiliaryTaskReadGuard, cancelTerminalReconciliation, taskProgressStore],
  )

  const handleTaskEvent = useCallback(
    (taskId: string, taskVersion: string, event: ProcessingTaskEvent) => {
      const transition = applyRuntimeEvent({ event, taskId, taskVersion, type: 'stream-event' })
      if (!transition.accepted) return false
      if (event.event === 'progress') taskProgressStore.set(taskId, event.data)
      else taskProgressStore.delete(taskId)
      if (!transition.terminal) return true

      failedTaskPollGenerationsRef.current.set(
        taskId,
        (failedTaskPollGenerationsRef.current.get(taskId) ?? 0) + 1,
      )
      cancelTerminalReconciliation(taskId)
      const reconciliationGeneration =
        (terminalReconciliationGenerationsRef.current.get(taskId) ?? 0) + 1
      terminalReconciliationGenerationsRef.current.set(taskId, reconciliationGeneration)
      if (transition.terminal.state === 'failed') onTaskFailed()
      onTaskReachedTerminal()
      void reconcileTerminalTask(taskId, transition.terminal.version, reconciliationGeneration)
      return true
    },
    [
      applyRuntimeEvent,
      cancelTerminalReconciliation,
      onTaskFailed,
      onTaskReachedTerminal,
      reconcileTerminalTask,
      taskProgressStore,
    ],
  )

  const handleTaskEventCursor = useCallback(
    (taskId: string, eventId?: string) => {
      applyRuntimeEvent({ eventId, taskId, type: 'event-cursor' })
    },
    [applyRuntimeEvent],
  )

  const handleTaskStreamPermissionDenied = useCallback(
    (taskId: string, taskVersion: string) => {
      terminalConfirmableAuxiliaryDenialsRef.current.set(taskId, {
        taskListGeneration: runtimeStateRef.current.listGeneration,
        taskVersion,
      })
      denyAuxiliaryTaskRead(taskId, taskVersion)
    },
    [denyAuxiliaryTaskRead],
  )

  useEffect(() => {
    if (permissionDenied) return
    for (const task of baseTasks) {
      const denial = terminalConfirmableAuxiliaryDenialsRef.current.get(task.id)
      if (!denial || runtimeState.listGeneration <= denial.taskListGeneration) continue
      if (taskIsActive(task)) {
        if (!taskVersionIsAfter(task.updatedAt, denial.taskVersion)) continue
        auxiliaryTaskReadGuard.clearTask(task.id)
        terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
        continue
      }
      if (!auxiliaryTaskReadGuard.clearThrough(task.id, task.updatedAt)) continue
      terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
      const effectiveTask = effectiveTaskById.get(task.id)
      if (effectiveTask && taskIsActive(effectiveTask))
        applyRuntimeEvent({ taskId: task.id, type: 'restart-observer' })
    }
  }, [
    applyRuntimeEvent,
    auxiliaryTaskReadGuard,
    baseTasks,
    effectiveTaskById,
    permissionDenied,
    runtimeState.listGeneration,
  ])

  useEffect(() => {
    if (permissionDenied) return
    for (const task of baseTasks) {
      if (taskIsActive(task)) continue
      const override = runtimeState.overrides[task.id]
      const trustedOverride = runtimeState.trustedActiveOverrides.get(task.id)
      if (
        !override?.updatedAt ||
        !taskIsActive(mergeTaskOverride(task, override)) ||
        taskVersionIsAfter(override.updatedAt, task.updatedAt) ||
        trustedOverride?.updatedAt !== override.updatedAt ||
        runtimeState.listGeneration <= trustedOverride.taskListGeneration ||
        runtimeState.trustedOverrideListGenerations.get(task.id) === runtimeState.listGeneration
      )
        continue
      applyRuntimeEvent({
        generation: runtimeState.listGeneration,
        taskId: task.id,
        type: 'trusted-override-checked',
      })
      const reconciliationGeneration =
        (terminalReconciliationGenerationsRef.current.get(task.id) ?? 0) + 1
      terminalReconciliationGenerationsRef.current.set(task.id, reconciliationGeneration)
      void reconcileTerminalTask(task.id, task.updatedAt, reconciliationGeneration)
    }
  }, [applyRuntimeEvent, baseTasks, permissionDenied, reconcileTerminalTask, runtimeState])

  useEffect(() => {
    const taskIds = new Set(baseTasks.map((task) => task.id))
    const pruneMap = (map: Map<string, unknown>) => {
      for (const taskId of map.keys()) if (!taskIds.has(taskId)) map.delete(taskId)
    }
    for (const taskId of terminalReconciliationControllersRef.current.keys()) {
      if (!taskIds.has(taskId)) cancelTerminalReconciliation(taskId)
    }
    pruneMap(terminalReconciliationGenerationsRef.current)
    pruneMap(failedTaskPollGenerationsRef.current)
    pruneMap(blockedFailedTaskPollVersionsRef.current)
    pruneMap(failedPollAuxiliaryDenialsRef.current)
    pruneMap(terminalConfirmableAuxiliaryDenialsRef.current)
    pruneMap(equalRetryListGenerationsRef.current)
    auxiliaryTaskReadGuard.retain(taskIds)
    taskProgressStore.retain(taskIds)
  }, [auxiliaryTaskReadGuard, baseTasks, cancelTerminalReconciliation, taskProgressStore])

  useEffect(() => {
    if (permissionDenied) return
    for (const task of baseTasks) {
      const pin = runtimeState.terminalPins[task.id]
      if (!pin || runtimeState.listGeneration <= pin.taskListGeneration) continue
      if (!taskIsActive(task) && !taskVersionIsAfter(pin.observedAt, task.updatedAt)) {
        terminalReconciliationGenerationsRef.current.set(
          task.id,
          (terminalReconciliationGenerationsRef.current.get(task.id) ?? 0) + 1,
        )
        cancelTerminalReconciliation(task.id)
        applyRuntimeEvent({ task, type: 'terminal-confirmed' })
        continue
      }
      if (taskIsActive(task) && taskVersionIsAfter(task.updatedAt, pin.observedAt)) {
        taskProgressStore.delete(task.id)
        blockedFailedTaskPollVersionsRef.current.delete(task.id)
        auxiliaryTaskReadGuard.clearTask(task.id)
        failedPollAuxiliaryDenialsRef.current.delete(task.id)
        terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
        failedTaskPollGenerationsRef.current.set(
          task.id,
          (failedTaskPollGenerationsRef.current.get(task.id) ?? 0) + 1,
        )
        terminalReconciliationGenerationsRef.current.set(
          task.id,
          (terminalReconciliationGenerationsRef.current.get(task.id) ?? 0) + 1,
        )
        cancelTerminalReconciliation(task.id)
        applyRuntimeEvent({ task, type: 'retry-confirmed' })
        continue
      }
      if (
        taskIsActive(task) &&
        !taskVersionIsAfter(pin.observedAt, task.updatedAt) &&
        equalRetryListGenerationsRef.current.get(task.id) !== runtimeState.listGeneration
      ) {
        equalRetryListGenerationsRef.current.set(task.id, runtimeState.listGeneration)
        auxiliaryTaskReadGuard.clearTask(task.id)
        failedPollAuxiliaryDenialsRef.current.delete(task.id)
        terminalConfirmableAuxiliaryDenialsRef.current.delete(task.id)
        cancelTerminalReconciliation(task.id)
        const reconciliationGeneration =
          (terminalReconciliationGenerationsRef.current.get(task.id) ?? 0) + 1
        terminalReconciliationGenerationsRef.current.set(task.id, reconciliationGeneration)
        void reconcileTerminalTask(task.id, pin.observedAt, reconciliationGeneration)
      }
    }
  }, [
    applyRuntimeEvent,
    auxiliaryTaskReadGuard,
    baseTasks,
    cancelTerminalReconciliation,
    permissionDenied,
    reconcileTerminalTask,
    runtimeState.listGeneration,
    runtimeState.terminalPins,
    taskProgressStore,
  ])

  useEffect(() => {
    if (permissionDenied) return
    for (const task of baseTasks) {
      if (!taskIsActive(task)) continue
      const denial = failedPollAuxiliaryDenialsRef.current.get(task.id)
      if (!denial || runtimeState.listGeneration <= denial.taskListGeneration) continue
      if (taskVersionIsAfter(denial.taskVersion, task.updatedAt)) continue
      failedPollAuxiliaryDenialsRef.current.delete(task.id)
      acceptTaskSnapshot(task)
    }
  }, [acceptTaskSnapshot, baseTasks, permissionDenied, runtimeState.listGeneration])

  useEffect(() => {
    for (const task of activeTasks) {
      if (!blockedFailedTaskPollVersionsRef.current.delete(task.id)) continue
      failedTaskPollGenerationsRef.current.set(
        task.id,
        (failedTaskPollGenerationsRef.current.get(task.id) ?? 0) + 1,
      )
    }
  }, [activeTasks])

  useEffect(() => {
    if (permissionDenied || !tasksOpen || !orderedFailedTasksRef.current.length) return
    let canceled = false
    let timeout: number | undefined
    const cancelRequests = new Set<() => void>()
    const pollNextBatch = async () => {
      const pollableTasks = orderedFailedTasksRef.current.filter(
        (task) =>
          blockedFailedTaskPollVersionsRef.current.get(task.id) !== task.updatedAt &&
          !auxiliaryTaskReadGuard.isBlocked(task.id, task.updatedAt),
      )
      if (pollableTasks.length) {
        const pollCount = Math.min(MAX_TASK_EVENT_STREAMS, pollableTasks.length)
        const offset = failedTaskPollOffsetRef.current % pollableTasks.length
        const tasksToPoll = Array.from(
          { length: pollCount },
          (_, index) => pollableTasks[(offset + index) % pollableTasks.length]!,
        )
        failedTaskPollOffsetRef.current += MAX_TASK_EVENT_STREAMS
        const requestGenerations = new Map<string, number>()
        for (const task of tasksToPoll) {
          const generation = (failedTaskPollGenerationsRef.current.get(task.id) ?? 0) + 1
          failedTaskPollGenerationsRef.current.set(task.id, generation)
          requestGenerations.set(task.id, generation)
        }
        const requestController = new AbortController()
        let requestTimeout: number | undefined
        let rejectDeadline: ((reason?: unknown) => void) | undefined
        const cancelRequest = () => {
          requestController.abort()
          rejectDeadline?.(new DOMException('Task snapshot request aborted', 'AbortError'))
        }
        try {
          const request = findBackgroundTasks(
            knowledgeSpaceId,
            new Set(tasksToPoll.map((task) => task.id)),
            requestController.signal,
          )
          const deadline = new Promise<never>((_resolve, reject) => {
            rejectDeadline = reject
            requestTimeout = window.setTimeout(() => {
              requestController.abort()
              reject(new DOMException('Task snapshot request timed out', 'TimeoutError'))
            }, FAILED_TASK_POLL_REQUEST_TIMEOUT)
          })
          cancelRequests.add(cancelRequest)
          const snapshots = await Promise.race([request, deadline])
          for (const task of tasksToPoll) {
            const snapshot = snapshots.get(task.id)
            if (
              !snapshot ||
              canceled ||
              failedTaskPollGenerationsRef.current.get(task.id) !== requestGenerations.get(task.id)
            )
              continue
            acceptTaskSnapshot(snapshot)
          }
        } catch (error) {
          for (const task of tasksToPoll) {
            if (
              canceled ||
              failedTaskPollGenerationsRef.current.get(task.id) !== requestGenerations.get(task.id)
            )
              continue
            if (responseStatus(error) === 403) {
              const currentTaskVersion = runtimeStateRef.current.currentVersions.get(task.id)
              const deniedVersion =
                currentTaskVersion && taskVersionIsAfter(currentTaskVersion, task.updatedAt)
                  ? currentTaskVersion
                  : task.updatedAt
              failedPollAuxiliaryDenialsRef.current.set(task.id, {
                taskListGeneration: runtimeStateRef.current.listGeneration,
                taskVersion: deniedVersion,
              })
              denyAuxiliaryTaskRead(task.id, deniedVersion)
            } else if (!taskSnapshotErrorIsTransient(error))
              blockedFailedTaskPollVersionsRef.current.set(task.id, task.updatedAt)
          }
        } finally {
          if (requestTimeout !== undefined) window.clearTimeout(requestTimeout)
          cancelRequests.delete(cancelRequest)
        }
      }
      if (!canceled) timeout = window.setTimeout(() => void pollNextBatch(), 5000)
    }
    timeout = window.setTimeout(() => void pollNextBatch(), 5000)
    return () => {
      canceled = true
      for (const cancelRequest of cancelRequests) cancelRequest()
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [
    acceptTaskSnapshot,
    auxiliaryTaskReadGuard,
    denyAuxiliaryTaskRead,
    failedTaskPollSignature,
    knowledgeSpaceId,
    permissionDenied,
    tasksOpen,
  ])

  useEffect(
    () => () => {
      for (const taskId of terminalReconciliationControllersRef.current.keys())
        cancelTerminalReconciliation(taskId)
    },
    [cancelTerminalReconciliation, knowledgeSpaceId],
  )

  return {
    acceptTaskSnapshot,
    activeTasks,
    baseTasks,
    drawerTasks,
    handleTaskEvent,
    handleTaskEventCursor,
    handleTaskStreamPermissionDenied,
    observerGeneration: (taskId: string) => runtimeState.observerGenerations[taskId] ?? 0,
    observerVersion,
    resetFailedPollBlocks: () => blockedFailedTaskPollVersionsRef.current.clear(),
    runtimeState,
    streamedActiveTasks,
    taskProgressStore,
    taskPermissionDenied,
    tasksQuery,
    tasks,
  }
}
