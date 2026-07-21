'use client'

import type {
  DocumentProcessingTask,
  LogicalDocument,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { TaskProgressStore } from './task-progress-store'
import { Button } from '@langgenius/dify-ui/button'
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
import { consoleQuery } from '@/service/client'
import { taskCanRetry, taskIsActive, taskVersionIsAfter } from './document-model'

type TaskAction = 'cancel' | 'retry'

const TASK_DRAWER_LIMIT = 100
const noopSubscribe = () => () => undefined

function taskTime(task: DocumentProcessingTask) {
  return task.completedAt ?? task.updatedAt
}

function taskLifecycle(task: DocumentProcessingTask) {
  return `${task.updatedAt}:${task.state}`
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

function compareTaskRecency(left: DocumentProcessingTask, right: DocumentProcessingTask) {
  if (taskVersionIsAfter(left.updatedAt, right.updatedAt)) return -1
  if (taskVersionIsAfter(right.updatedAt, left.updatedAt)) return 1
  return right.id.localeCompare(left.id)
}

function newestTasks(
  tasks: DocumentProcessingTask[],
  limit: number,
  predicate: (task: DocumentProcessingTask) => boolean,
) {
  const selected: DocumentProcessingTask[] = []
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
  onTaskUpdated,
  onWritePermissionDenied,
  open,
  taskQueryError,
  taskQueryFetching,
  taskQueryPending,
  tasks,
  taskProgressStore,
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
  onTaskUpdated: (task: DocumentProcessingTask) => void
  onWritePermissionDenied: () => void
  open: boolean
  taskQueryError: boolean
  taskQueryFetching: boolean
  taskQueryPending: boolean
  tasks: DocumentProcessingTask[]
  taskProgressStore: TaskProgressStore
  onRetryDocumentQuery: () => void
  onRetryTaskQuery: () => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const cancelTask = useMutation(
    consoleQuery.knowledgeFs.deleteKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId.mutationOptions(),
  )
  const retryTask = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdRetry.mutationOptions(),
  )
  const pendingActionsRef = useRef(new Set<string>())
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null)
  const taskQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const focusedTaskActionRef = useRef<HTMLButtonElement | null>(null)
  const loadMoreRequestedRef = useRef(false)
  const queryRetryFocusRequestedRef = useRef(false)
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
    return {
      ...task,
      errorCode: undefined,
      errorMessage: undefined,
      ...progress,
    }
  })
  const activeActionCount = orderedTasks.filter(taskIsActive).length
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
    const focusedAction = focusedTaskActionRef.current
    if (!open || !focusedAction || focusedAction.isConnected) return
    focusedTaskActionRef.current = null
    drawerCloseButtonRef.current?.focus()
  }, [open, orderedTasks])

  const performAction = async (task: DocumentProcessingTask, action: TaskAction) => {
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
      const input = {
        params: {
          documentId: task.documentId,
          id: knowledgeSpaceId,
          taskId: task.id,
        },
      }
      const updated =
        action === 'cancel'
          ? await cancelTask.mutateAsync(input)
          : await retryTask.mutateAsync(input)
      if (
        !actionResultsValidRef.current ||
        taskLifecycleGenerationsRef.current.get(task.id)?.generation !== actionLifecycleGeneration
      )
        return
      onTaskUpdated(updated)
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
      if (responseStatus(error) === 403) onWritePermissionDenied()
      if (
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
          <DrawerPopup className="data-[swipe-direction=right]:w-[440px] data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <header className="shrink-0 px-6 pt-5 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <DrawerTitle className="system-md-semibold text-text-primary">
                    {t(($) => $['newKnowledge.backgroundTasks'])}
                  </DrawerTitle>
                  <DrawerCloseButton
                    ref={drawerCloseButtonRef}
                    aria-label={tCommon(($) => $['operation.close'])}
                    className="size-6 rounded-md"
                  />
                </div>
                <DrawerDescription className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.backgroundTasksDescription'])}
                </DrawerDescription>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
                  <ul className="divide-y divide-divider-subtle">
                    {orderedTasks.map((task) => {
                      const title =
                        documentTitles.get(task.documentId) ??
                        (documentsPending
                          ? t(($) => $['newKnowledge.documentColumn'])
                          : task.documentId)
                      const timestamp = Date.parse(
                        taskIsActive(task) ? task.createdAt : taskTime(task),
                      )
                      const taskError = task.errorMessage ?? task.errorCode
                      const actionTarget = `${documentTitles.get(task.documentId) ?? task.documentId} · ${task.id}`
                      return (
                        <li key={task.id} className="flex min-h-[62px] items-center gap-2.5 py-3.5">
                          <span
                            aria-hidden
                            className={
                              task.state === 'failed'
                                ? 'i-ri-error-warning-fill size-4 shrink-0 text-text-destructive'
                                : taskIsActive(task)
                                  ? 'i-ri-loader-2-line size-4 shrink-0 animate-spin text-text-accent motion-reduce:animate-none'
                                  : task.state === 'succeeded'
                                    ? 'i-ri-check-line size-4 shrink-0 text-text-success'
                                    : 'i-ri-indeterminate-circle-line size-4 shrink-0 text-text-tertiary'
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate system-xs-medium text-text-primary">
                              {t(($) => $['newKnowledge.processDocument'], { name: title })}
                            </p>
                            <p className="mt-0.5 truncate system-2xs-regular text-text-tertiary">
                              {t(($) => $[`newKnowledge.processingTaskState.${task.state}`], {
                                progress: task.progressPercent,
                              })}
                              {!Number.isNaN(timestamp) && (
                                <>
                                  <span aria-hidden> · </span>
                                  {formatTimeFromNow(timestamp)}
                                </>
                              )}
                            </p>
                            {taskError && (
                              <p className="mt-1 system-2xs-regular break-words whitespace-pre-wrap text-text-destructive">
                                {taskError}
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
                          {canEdit && taskIsActive(task) ? (
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
