'use client'

import type { BackgroundTask, DocumentProcessingTask, LogicalDocument } from './document-models'
import type { TaskProgressStore } from './task-progress-store'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleClient } from '@/service/client'
import { taskCanCancel, taskCanRetry, taskIsActive, taskVersionIsAfter } from './document-model'
import { backgroundTaskFromApi } from './document-models'
import {
  knowledgeFsTaskFailureMessageKey,
  knowledgeFsTaskRecoveryPath,
} from './knowledge-fs-task-error'

type TaskAction = 'cancel' | 'retry'

const TASK_DRAWER_LIMIT = 100
const noopSubscribe = () => () => undefined

function taskTime(task: BackgroundTask) {
  return task.completedAt ?? task.updatedAt
}

function taskLifecycle(task: BackgroundTask) {
  return `${task.updatedAt}:${task.state}`
}

function taskProgress(task: BackgroundTask) {
  if (!task.progressTotal) return
  return {
    completed: Math.min(
      (task.progressCompleted ?? 0) + (task.progressFailed ?? 0),
      task.progressTotal,
    ),
    total: task.progressTotal,
  }
}

function responseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error)
    return typeof error.status === 'number' ? error.status : undefined
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

function compareTaskRecency(left: BackgroundTask, right: BackgroundTask) {
  if (taskVersionIsAfter(left.updatedAt, right.updatedAt)) return -1
  if (taskVersionIsAfter(right.updatedAt, left.updatedAt)) return 1
  return right.id.localeCompare(left.id)
}

function newestTasks(
  tasks: BackgroundTask[],
  limit: number,
  predicate: (task: BackgroundTask) => boolean,
) {
  const selected: BackgroundTask[] = []
  for (const task of tasks) {
    if (!predicate(task)) continue
    let low = 0
    let high = selected.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (compareTaskRecency(task, selected[middle]!) < 0) high = middle
      else low = middle + 1
    }
    selected.splice(low, 0, task)
    if (selected.length > limit) selected.pop()
  }
  return selected
}

export function ProcessingTasksDrawer({
  canEdit,
  actionResultsValid,
  documentQueryError,
  documentQueryFetching,
  documents,
  documentsPending,
  hasNextDocumentPage,
  hasNextTaskPage,
  hasUnresolvedTaskDocuments,
  isFetchingNextDocumentPage,
  isFetchingNextTaskPage,
  knowledgeSpaceId,
  onLoadMoreDocuments,
  onLoadMoreTasks,
  onOpenChange,
  onRefreshDocumentsAndTasks,
  onRetryPermissionQuery,
  onTaskUpdated,
  onWritePermissionDenied,
  open,
  permissionQueryError,
  permissionQueryFetching,
  permissionQueryPending,
  readOnlyReason,
  taskQueryError,
  taskQueryFetching,
  taskQueryPending,
  tasks,
  taskProgressStore,
  sourceNames,
  onRetryTaskQuery,
  onRetryDocumentQuery,
}: {
  canEdit: boolean
  actionResultsValid: boolean
  documentQueryError: boolean
  documentQueryFetching: boolean
  documents: LogicalDocument[]
  documentsPending: boolean
  hasNextDocumentPage: boolean
  hasNextTaskPage: boolean
  hasUnresolvedTaskDocuments: boolean
  isFetchingNextDocumentPage: boolean
  isFetchingNextTaskPage: boolean
  knowledgeSpaceId: string
  onLoadMoreDocuments: () => void
  onLoadMoreTasks: () => void
  onOpenChange: (open: boolean) => void
  onRefreshDocumentsAndTasks: () => void
  onRetryPermissionQuery: () => void
  onTaskUpdated: (task: DocumentProcessingTask) => void
  onWritePermissionDenied: () => void
  open: boolean
  permissionQueryError: boolean
  permissionQueryFetching: boolean
  permissionQueryPending: boolean
  readOnlyReason?: string
  taskQueryError: boolean
  taskQueryFetching: boolean
  taskQueryPending: boolean
  tasks: BackgroundTask[]
  taskProgressStore: TaskProgressStore
  sourceNames?: Map<string, string>
  onRetryDocumentQuery: () => void
  onRetryTaskQuery: () => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const cancelTask = useMutation({
    mutationFn: async (task: BackgroundTask) =>
      backgroundTaskFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.cancel.post(
          {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: task.id,
              task_kind: task.taskKind,
            },
          },
        ),
      ),
  })
  const retryTask = useMutation({
    mutationFn: async (task: BackgroundTask) =>
      backgroundTaskFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post(
          {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: task.id,
              task_kind: task.taskKind,
            },
          },
        ),
      ),
  })
  const pendingActionsRef = useRef(new Set<string>())
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null)
  const taskQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const permissionQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const focusedTaskActionRef = useRef<HTMLButtonElement | null>(null)
  const loadMoreRequestedRef = useRef(false)
  const queryRetryFocusRequestedRef = useRef(false)
  const permissionRetryFocusRequestedRef = useRef(false)
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
  const openCycleRef = useRef(0)
  const openRef = useRef(open)
  const actionResultsValidRef = useRef(actionResultsValid)
  const previousOpenRef = useRef(open)
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set())
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [visibleTaskLimit, setVisibleTaskLimit] = useState(TASK_DRAWER_LIMIT)
  useSyncExternalStore(
    open ? taskProgressStore.subscribe : noopSubscribe,
    taskProgressStore.getSnapshot,
    taskProgressStore.getSnapshot,
  )
  const documentTitles = useMemo(
    () => new Map(documents.map((document) => [document.id, document.title])),
    [documents],
  )
  const orderedBaseTasks = useMemo(() => {
    if (!open) return []
    const reservedLimit = Math.min(TASK_DRAWER_LIMIT / 2, visibleTaskLimit)
    const retryableTasks = newestTasks(tasks, reservedLimit, taskCanRetry)
    const activeTasks = newestTasks(tasks, reservedLimit, taskIsActive)
    const attentionTaskIds = new Set([
      ...retryableTasks.map((task) => task.id),
      ...activeTasks.map((task) => task.id),
    ])
    const remainingAttentionTasks = newestTasks(
      tasks,
      visibleTaskLimit - attentionTaskIds.size,
      (task) => (taskCanRetry(task) || taskIsActive(task)) && !attentionTaskIds.has(task.id),
    )
    for (const task of remainingAttentionTasks) attentionTaskIds.add(task.id)
    const terminalTasks = newestTasks(
      tasks,
      visibleTaskLimit - attentionTaskIds.size,
      (task) => !attentionTaskIds.has(task.id),
    )
    return [...retryableTasks, ...activeTasks, ...remainingAttentionTasks, ...terminalTasks].sort(
      compareTaskRecency,
    )
  }, [open, tasks, visibleTaskLimit])
  const hasMoreTasks =
    open &&
    (tasks.length > orderedBaseTasks.length ||
      hasNextTaskPage ||
      (hasUnresolvedTaskDocuments && hasNextDocumentPage))
  const orderedTasks = orderedBaseTasks.map((task) => {
    const progress = taskProgressStore.get(task.id)
    if (!progress || !taskIsActive(task) || taskVersionIsAfter(task.updatedAt, progress.updatedAt))
      return task
    const stateChanged = progress.state !== task.state
    return {
      ...task,
      ...(stateChanged ? { canCancel: undefined, canRetry: undefined } : {}),
      errorCode: undefined,
      errorMessage: undefined,
      failure: undefined,
      ...progress,
    }
  })
  const activeActionCount = orderedTasks.filter(taskCanCancel).length
  const retryActionCount = orderedTasks.filter(taskCanRetry).length
  const taskLifecycles = useMemo(
    () => new Map(tasks.map((task) => [task.id, taskLifecycle(task)])),
    [tasks],
  )
  const taskLifecycleGenerationsRef = useRef(
    new Map<string, { generation: number; lifecycle: string }>(),
  )
  useLayoutEffect(() => {
    actionResultsValidRef.current = actionResultsValid
    const currentTaskIds = new Set(tasks.map((task) => task.id))
    for (const task of tasks) {
      const lifecycle = taskLifecycle(task)
      const previous = taskLifecycleGenerationsRef.current.get(task.id)
      if (previous?.lifecycle === lifecycle) continue
      taskLifecycleGenerationsRef.current.set(task.id, {
        generation: (previous?.generation ?? 0) + 1,
        lifecycle,
      })
    }
    for (const taskId of taskLifecycleGenerationsRef.current.keys()) {
      if (!currentTaskIds.has(taskId)) taskLifecycleGenerationsRef.current.delete(taskId)
    }
  }, [actionResultsValid, tasks])

  useEffect(() => {
    openRef.current = open
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open
    if (!wasOpen || open) return
    openCycleRef.current += 1
    loadMoreRequestedRef.current = false
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Every committed controlled close resets drawer-local pagination and errors.
    setVisibleTaskLimit(TASK_DRAWER_LIMIT)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Every committed controlled close starts a fresh action-error cycle.
    setActionErrors({})
  }, [open])

  useEffect(() => {
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Task lifecycle changes retire action errors from older task versions.
    setActionErrors((current) => {
      const staleTaskIds = Object.keys(current).filter(
        (taskId) => taskLifecycles.get(taskId) !== current[taskId],
      )
      if (!staleTaskIds.length) return current
      const next = { ...current }
      for (const taskId of staleTaskIds) delete next[taskId]
      return next
    })
  }, [taskLifecycles])

  useEffect(() => {
    if (!open) return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- A newly opened drawer starts a fresh action-error cycle.
    setActionErrors({})
  }, [open])

  useEffect(() => {
    if (!open || hasMoreTasks || !loadMoreRequestedRef.current) return
    loadMoreRequestedRef.current = false
    drawerCloseButtonRef.current?.focus()
  }, [hasMoreTasks, open])

  useEffect(() => {
    const queryRetryVisible = taskQueryError || (documentQueryError && hasUnresolvedTaskDocuments)
    if (!open || !queryRetryFocusRequestedRef.current) return
    if (queryRetryVisible) {
      if (taskQueryError) taskQueryRetryButtonRef.current?.focus()
      else documentQueryRetryButtonRef.current?.focus()
      return
    }
    queryRetryFocusRequestedRef.current = false
    drawerCloseButtonRef.current?.focus()
  }, [documentQueryError, hasUnresolvedTaskDocuments, open, taskQueryError])

  useEffect(() => {
    if (!open || !permissionRetryFocusRequestedRef.current) return
    if (permissionQueryError) {
      permissionQueryRetryButtonRef.current?.focus()
      return
    }
    permissionRetryFocusRequestedRef.current = false
    drawerCloseButtonRef.current?.focus()
  }, [open, permissionQueryError])

  useEffect(() => {
    const focusedAction = focusedTaskActionRef.current
    if (!open || !focusedAction || focusedAction.isConnected) return
    focusedTaskActionRef.current = null
    drawerCloseButtonRef.current?.focus()
  }, [open, orderedTasks])

  const performAction = async (task: BackgroundTask, action: TaskAction) => {
    if (!canEdit || pendingActionsRef.current.has(task.id)) return
    pendingActionsRef.current.add(task.id)
    const actionOpenCycle = openCycleRef.current
    const actionLifecycleGeneration = taskLifecycleGenerationsRef.current.get(task.id)?.generation
    const actionFocusTarget = document.activeElement
    setPendingActions((current) => new Set(current).add(task.id))
    setActionErrors((current) => {
      const next = { ...current }
      delete next[task.id]
      return next
    })
    try {
      const updated =
        action === 'cancel' ? await cancelTask.mutateAsync(task) : await retryTask.mutateAsync(task)
      if (
        !actionResultsValidRef.current ||
        taskLifecycleGenerationsRef.current.get(task.id)?.generation !== actionLifecycleGeneration
      )
        return
      if (updated.documentId && updated.documentRevision)
        onTaskUpdated(updated as DocumentProcessingTask)
      setActionErrors((current) => {
        const next = { ...current }
        delete next[task.id]
        return next
      })
      if (
        actionResultsValidRef.current &&
        openRef.current &&
        openCycleRef.current === actionOpenCycle &&
        document.activeElement === actionFocusTarget
      )
        drawerCloseButtonRef.current?.focus()
    } catch (error) {
      const permissionDenied = responseStatus(error) === 403
      if (permissionDenied) onWritePermissionDenied()
      if (
        !permissionDenied &&
        actionResultsValidRef.current &&
        openRef.current &&
        openCycleRef.current === actionOpenCycle &&
        taskLifecycleGenerationsRef.current.get(task.id)?.generation === actionLifecycleGeneration
      )
        setActionErrors((current) => ({ ...current, [task.id]: taskLifecycle(task) }))
    } finally {
      pendingActionsRef.current.delete(task.id)
      setPendingActions((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
      if (actionResultsValidRef.current) onRefreshDocumentsAndTasks()
    }
  }

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={(nextOpen) => {
        openRef.current = nextOpen
        onOpenChange(nextOpen)
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:w-110 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <header className="relative shrink-0 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pr-[calc(1.5rem+env(safe-area-inset-right,0px))] pb-3.5 pl-[calc(1.5rem+env(safe-area-inset-left,0px))]">
                <DrawerTitle className="pr-9 system-md-semibold text-text-primary">
                  {t(($) => $['newKnowledge.backgroundTasks'])}
                </DrawerTitle>
                <DrawerCloseButton
                  ref={drawerCloseButtonRef}
                  aria-label={tCommon(($) => $['operation.close'])}
                  className="absolute top-[calc(1.25rem+env(safe-area-inset-top,0px))] right-[calc(1.5rem+env(safe-area-inset-right,0px))] size-6.5 rounded-md"
                />
                <DrawerDescription className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.backgroundTasksDescription'])}
                </DrawerDescription>
                {readOnlyReason && (
                  <p
                    className="mt-2 inline-flex items-center gap-1.5 system-xs-regular text-text-warning"
                    role="status"
                  >
                    <span aria-hidden className="i-ri-lock-line size-3.5" />
                    {readOnlyReason}
                  </p>
                )}
                {permissionQueryPending && (
                  <p className="mt-2 system-xs-regular text-text-tertiary" role="status">
                    {t(($) => $['newKnowledge.permission'])}
                    {' · '}
                    {tCommon(($) => $.loading)}
                  </p>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto pr-[calc(1.5rem+env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[calc(1.5rem+env(safe-area-inset-left,0px))]">
                {permissionQueryError && (
                  <div className="mb-3 rounded-xl border border-divider-regular p-4" role="alert">
                    <p className="system-xs-regular text-text-destructive">
                      {t(($) => $['newKnowledge.permissionLoadFailed'])}
                    </p>
                    <Button
                      ref={permissionQueryRetryButtonRef}
                      aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.permissionLoadFailed'])}`}
                      aria-busy={permissionQueryFetching}
                      className="mt-3"
                      loading={permissionQueryFetching}
                      size="small"
                      onBlur={(event) => {
                        if (event.relatedTarget) permissionRetryFocusRequestedRef.current = false
                      }}
                      onClick={() => {
                        permissionRetryFocusRequestedRef.current = true
                        onRetryPermissionQuery()
                      }}
                    >
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                )}
                {taskQueryError && (
                  <div className="mb-3 rounded-xl border border-divider-regular p-4" role="alert">
                    <p className="system-xs-regular text-text-destructive">
                      {t(($) => $['newKnowledge.tasksErrorDescription'])}
                    </p>
                    <Button
                      ref={taskQueryRetryButtonRef}
                      aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.tasksErrorDescription'])}`}
                      aria-busy={taskQueryFetching}
                      className="mt-3"
                      loading={taskQueryFetching}
                      size="small"
                      onBlur={(event) => {
                        if (event.relatedTarget) queryRetryFocusRequestedRef.current = false
                      }}
                      onClick={() => {
                        queryRetryFocusRequestedRef.current = true
                        onRetryTaskQuery()
                      }}
                    >
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                )}
                {documentQueryError && hasUnresolvedTaskDocuments && (
                  <div className="mb-3 rounded-xl border border-divider-regular p-4" role="alert">
                    <p className="system-xs-regular text-text-destructive">
                      {t(($) => $['newKnowledge.documentsErrorDescription'])}
                    </p>
                    <Button
                      ref={documentQueryRetryButtonRef}
                      aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
                      aria-busy={documentQueryFetching}
                      className="mt-3"
                      loading={documentQueryFetching}
                      size="small"
                      onBlur={(event) => {
                        if (event.relatedTarget) queryRetryFocusRequestedRef.current = false
                      }}
                      onClick={() => {
                        queryRetryFocusRequestedRef.current = true
                        onRetryDocumentQuery()
                      }}
                    >
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                )}
                {taskQueryPending && !orderedTasks.length ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Loading />
                  </div>
                ) : orderedTasks.length ? (
                  <ul>
                    {orderedTasks.map((task) => {
                      const documentTitle = task.documentId
                        ? (documentTitles.get(task.documentId) ??
                          (documentsPending
                            ? t(($) => $['newKnowledge.documentColumn'])
                            : task.documentId))
                        : undefined
                      const operationTitle = t(
                        ($) => $[`newKnowledge.overview.operation.${task.operation}`],
                      )
                      const progress = taskProgress(task)
                      const sourceTitle = task.sourceId
                        ? sourceNames?.get(task.sourceId)
                        : undefined
                      const title =
                        task.operation === 'document_processing' && documentTitle
                          ? `${t(($) => $['newKnowledge.addDocument'])} · ${documentTitle}`
                          : task.operation === 'document_upload'
                            ? `${t(($) => $['newKnowledge.addDocument'])}${progress ? ` · ${progress.total}` : ''}`
                            : task.operation === 'document_reindex'
                              ? `${t(($) => $['newKnowledge.reindexDocuments'])}${progress ? ` · ${progress.total}` : documentTitle ? ` · ${documentTitle}` : ''}`
                              : sourceTitle
                                ? `${operationTitle} · ${sourceTitle}`
                                : progress
                                  ? `${operationTitle} · ${progress.total}`
                                  : operationTitle
                      const timestamp = Date.parse(
                        taskIsActive(task) ? task.createdAt : taskTime(task),
                      )
                      const relativeTime = Number.isNaN(timestamp)
                        ? undefined
                        : formatTimeFromNow(timestamp)
                      const progressLabel = progress
                        ? progress.total > 1
                          ? `${progress.completed}/${progress.total}`
                          : `${task.progressPercent}%`
                        : undefined
                      const stateLabel = t(
                        ($) => $[`newKnowledge.processingTaskState.${task.state}`],
                        { progress: task.progressPercent },
                      )
                      const status =
                        task.state === 'queued' || task.state === 'dispatch_pending'
                          ? stateLabel
                          : task.state === 'running' && progressLabel
                            ? `${progressLabel}${relativeTime ? ` — ${relativeTime}` : ''}`
                            : task.state === 'failed' && progressLabel
                              ? `${progressLabel} — ${stateLabel}${relativeTime ? ` ${relativeTime}` : ''}`
                              : task.state === 'canceled' && progressLabel
                                ? `${stateLabel} — ${progressLabel}`
                                : task.state === 'succeeded'
                                  ? `${stateLabel}${relativeTime ? ` ${relativeTime}` : ''}`
                                  : `${stateLabel}${relativeTime ? ` · ${relativeTime}` : ''}`
                      const taskFailureMessageKey = knowledgeFsTaskFailureMessageKey(
                        task.failure,
                        task.errorCode ?? (task.errorMessage ? 'LEGACY_TASK_FAILURE' : undefined),
                      )
                      const taskError = taskFailureMessageKey
                        ? t(($) => $[taskFailureMessageKey])
                        : undefined
                      const recoveryPath = knowledgeFsTaskRecoveryPath(
                        task.failure,
                        knowledgeSpaceId,
                      )
                      const recoveryLabel =
                        task.failure?.action === 'configure_model'
                          ? tCommon(($) => $['datasetMenus.settings'])
                          : task.failure?.action === 'configure_source'
                            ? t(($) => $['newKnowledge.openSource'])
                            : task.failure?.action === 'reupload'
                              ? t(($) => $['newKnowledge.addDocument'])
                              : undefined
                      const actionTarget = `${title} · ${task.id}`
                      return (
                        <li key={task.id} className="flex min-h-15.5 items-center gap-2.5 py-3.5">
                          <span
                            aria-hidden
                            className={
                              task.state === 'failed'
                                ? 'i-ri-error-warning-fill size-4 shrink-0 text-text-destructive'
                                : task.state === 'dispatch_pending' ||
                                    task.state === 'queued' ||
                                    task.state === 'retry_wait'
                                  ? 'i-ri-time-line size-4 shrink-0 text-text-tertiary'
                                  : taskIsActive(task)
                                    ? 'i-ri-loader-2-line size-4 shrink-0 animate-spin text-text-accent motion-reduce:animate-none'
                                    : task.state === 'succeeded'
                                      ? 'i-ri-check-line size-4 shrink-0 text-text-success'
                                      : 'i-ri-indeterminate-circle-line size-4 shrink-0 text-text-tertiary'
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate system-sm-medium text-text-primary">{title}</p>
                            <p className="mt-0.75 truncate system-xs-regular text-text-tertiary">
                              {status}
                            </p>
                            {taskError && (
                              <p className="mt-1 system-2xs-regular wrap-break-word whitespace-pre-wrap text-text-destructive">
                                {taskError}
                              </p>
                            )}
                            {task.failure?.traceId && task.failure.category === 'internal' && (
                              <p className="mt-1 system-2xs-regular text-text-tertiary">
                                {t(($) => $['newKnowledge.taskFailure.reference'], {
                                  traceId: task.failure?.traceId,
                                })}
                              </p>
                            )}
                            {actionErrors[task.id] === taskLifecycle(task) && (
                              <p
                                className="mt-1 system-2xs-regular text-text-destructive"
                                role="alert"
                              >
                                {t(($) => $['newKnowledge.taskActionFailed'])}
                              </p>
                            )}
                          </div>
                          {canEdit && taskCanCancel(task) ? (
                            <Button
                              aria-label={
                                activeActionCount > 1
                                  ? `${t(($) => $['newKnowledge.interruptTask'])} · ${actionTarget}`
                                  : undefined
                              }
                              size="small"
                              aria-busy={pendingActions.has(task.id)}
                              disabled={pendingActions.has(task.id)}
                              loading={pendingActions.has(task.id)}
                              onBlur={(event) => {
                                if (event.relatedTarget) focusedTaskActionRef.current = null
                              }}
                              onFocus={(event) => {
                                focusedTaskActionRef.current = event.currentTarget
                              }}
                              onClick={() => void performAction(task, 'cancel')}
                            >
                              {t(($) => $['newKnowledge.interruptTask'])}
                            </Button>
                          ) : canEdit && taskCanRetry(task) ? (
                            <Button
                              aria-label={
                                retryActionCount > 1
                                  ? `${t(($) => $['newKnowledge.retryTask'])} · ${actionTarget}`
                                  : undefined
                              }
                              size="small"
                              aria-busy={pendingActions.has(task.id)}
                              disabled={pendingActions.has(task.id)}
                              loading={pendingActions.has(task.id)}
                              onBlur={(event) => {
                                if (event.relatedTarget) focusedTaskActionRef.current = null
                              }}
                              onFocus={(event) => {
                                focusedTaskActionRef.current = event.currentTarget
                              }}
                              onClick={() => void performAction(task, 'retry')}
                            >
                              {t(($) => $['newKnowledge.retryTask'])}
                            </Button>
                          ) : canEdit && recoveryPath && recoveryLabel ? (
                            <Link
                              aria-label={`${recoveryLabel} · ${actionTarget}`}
                              className={buttonVariants({ size: 'small' })}
                              href={recoveryPath}
                            >
                              {recoveryLabel}
                            </Link>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : !taskQueryError && !hasMoreTasks ? (
                  <p className="py-16 text-center system-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.noBackgroundTasks'])}
                  </p>
                ) : null}
                {hasMoreTasks && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      ref={loadMoreButtonRef}
                      aria-busy={isFetchingNextTaskPage || isFetchingNextDocumentPage}
                      loading={isFetchingNextTaskPage || isFetchingNextDocumentPage}
                      onBlur={() => {
                        loadMoreRequestedRef.current = false
                      }}
                      onClick={() => {
                        loadMoreRequestedRef.current =
                          document.activeElement === loadMoreButtonRef.current
                        if (tasks.length <= orderedBaseTasks.length && hasNextTaskPage)
                          onLoadMoreTasks()
                        if (hasUnresolvedTaskDocuments && hasNextDocumentPage) onLoadMoreDocuments()
                        setVisibleTaskLimit((current) => current + TASK_DRAWER_LIMIT)
                      }}
                    >
                      {t(($) => $['newKnowledge.loadMore'])}
                    </Button>
                  </div>
                )}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
