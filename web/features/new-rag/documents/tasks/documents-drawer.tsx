'use client'

import type { BackgroundTask, DocumentProcessingTask } from '../models'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import {
  knowledgeFsTaskFailureMessageKey,
  knowledgeFsTaskRecoveryPath,
} from '../../knowledge-fs-task-error'
import { taskCanCancel, taskCanRetry, taskIsActive } from '../model'
import { backgroundTaskFromApi } from '../models'
import {
  acceptDocumentTaskSnapshotAtom,
  denyDocumentWriteAtom,
  documentCanWriteAtom,
} from '../state/runtime'
import { documentTasksOpenAtom, taskProgressStoreAtom } from '../state/scoped'
import { taskLifecycle, taskProgress, taskTime, taskWithStreamProgress } from './drawer-model'
import {
  createTaskDrawerRowLabelsAtom,
  resetTaskDrawerResultsWindowAtom,
  retryTaskDrawerDocumentsAtom,
  retryTaskDrawerTasksAtom,
  showMoreTaskDrawerResultsAtom,
  taskDrawerActionFactsAtom,
  taskDrawerLoadMoreFactsAtom,
  taskDrawerOpenAtom,
  taskDrawerOrderedBaseTasksAtom,
  taskDrawerQueryRecoveryFactsAtom,
  taskDrawerRowsStateAtom,
} from './drawer-state'
import { queryKeyMatchesKnowledgeSpace } from './recovery'

const TASK_DRAWER_CLOSE_SELECTOR = '[data-documents-task-drawer-close]'

function taskDrawerCloseButton(element: Element | null) {
  return element
    ?.closest('[role="dialog"]')
    ?.querySelector<HTMLButtonElement>(TASK_DRAWER_CLOSE_SELECTOR)
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

function DocumentsTaskDrawerHeader() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const canWrite = useAtomValue(documentCanWriteAtom)

  return (
    <header className="relative shrink-0 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pr-[calc(1.5rem+env(safe-area-inset-right,0px))] pb-3.5 pl-[calc(1.5rem+env(safe-area-inset-left,0px))]">
      <DrawerTitle className="pr-9 system-md-semibold text-text-primary">
        {t(($) => $['newKnowledge.backgroundTasks'])}
      </DrawerTitle>
      <DrawerCloseButton
        data-documents-task-drawer-close
        aria-label={tCommon(($) => $['operation.close'])}
        className="absolute top-[calc(1.25rem+env(safe-area-inset-top,0px))] right-[calc(1.5rem+env(safe-area-inset-right,0px))] size-6.5 rounded-md"
      />
      <DrawerDescription className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.backgroundTasksDescription'])}
      </DrawerDescription>
      {!canWrite && (
        <p
          className="mt-2 inline-flex items-center gap-1.5 system-xs-regular text-text-warning"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-line size-3.5" />
          {t(($) => $['newKnowledge.documentPermissionRestricted'])}
        </p>
      )}
    </header>
  )
}

function DocumentsTaskQueryRecovery() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const open = useAtomValue(taskDrawerOpenAtom)
  const recovery = useAtomValue(taskDrawerQueryRecoveryFactsAtom)
  const retryDocuments = useSetAtom(retryTaskDrawerDocumentsAtom)
  const retryTasks = useSetAtom(retryTaskDrawerTasksAtom)
  const taskRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentRetryButtonRef = useRef<HTMLButtonElement>(null)
  const retryCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const retryFocusRequestedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      retryFocusRequestedRef.current = false
      return
    }
    if (!retryFocusRequestedRef.current) return
    if (recovery.taskError) taskRetryButtonRef.current?.focus()
    else if (recovery.documentError) documentRetryButtonRef.current?.focus()
    else {
      retryFocusRequestedRef.current = false
      retryCloseButtonRef.current?.focus()
    }
  }, [open, recovery.documentError, recovery.taskError])

  return (
    <>
      {recovery.taskError && (
        <div className="mb-3 rounded-xl border border-divider-regular p-4" role="alert">
          <p className="system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.tasksErrorDescription'])}
          </p>
          <Button
            ref={taskRetryButtonRef}
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.tasksErrorDescription'])}`}
            aria-busy={recovery.taskFetching}
            className="mt-3"
            loading={recovery.taskFetching}
            size="small"
            onBlur={(event) => {
              if (event.relatedTarget) retryFocusRequestedRef.current = false
            }}
            onClick={(event) => {
              retryCloseButtonRef.current = taskDrawerCloseButton(event.currentTarget) ?? null
              retryFocusRequestedRef.current = true
              retryTasks()
            }}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      {recovery.documentError && (
        <div className="mb-3 rounded-xl border border-divider-regular p-4" role="alert">
          <p className="system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.documentsErrorDescription'])}
          </p>
          <Button
            ref={documentRetryButtonRef}
            aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsErrorDescription'])}`}
            aria-busy={recovery.documentFetching}
            className="mt-3"
            loading={recovery.documentFetching}
            size="small"
            onBlur={(event) => {
              if (event.relatedTarget) retryFocusRequestedRef.current = false
            }}
            onClick={(event) => {
              retryCloseButtonRef.current = taskDrawerCloseButton(event.currentTarget) ?? null
              retryFocusRequestedRef.current = true
              retryDocuments()
            }}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
    </>
  )
}

function useDocumentsTaskRowTitle(task: BackgroundTask) {
  const { t } = useTranslation('dataset')
  const rowLabelsAtom = useMemo(() => createTaskDrawerRowLabelsAtom(task), [task])
  const {
    documentTitle: resolvedDocumentTitle,
    documentTitlePending,
    sourceTitle,
  } = useAtomValue(rowLabelsAtom)
  const documentTitle =
    resolvedDocumentTitle ??
    (task.documentId
      ? documentTitlePending
        ? t(($) => $['newKnowledge.documentColumn'])
        : task.documentId
      : undefined)
  const operationTitle = t(($) => $[`newKnowledge.overview.operation.${task.operation}`])
  const progress = taskProgress(task)

  return task.operation === 'document_processing' && documentTitle
    ? `${t(($) => $['newKnowledge.addDocument'])} · ${documentTitle}`
    : task.operation === 'document_upload'
      ? `${t(($) => $['newKnowledge.addDocument'])}${progress ? ` · ${progress.total}` : ''}`
      : task.operation === 'document_reindex'
        ? `${t(($) => $['newKnowledge.reindexDocuments'])}${progress ? ` · ${progress.total}` : documentTitle ? ` · ${documentTitle}` : ''}`
        : task.operation === 'document_delete' && documentTitle
          ? `${operationTitle} · ${documentTitle}`
          : sourceTitle
            ? `${operationTitle} · ${sourceTitle}`
            : progress
              ? `${operationTitle} · ${progress.total}`
              : operationTitle
}

function DocumentsTaskDetails({ task }: { task: BackgroundTask }) {
  const { t } = useTranslation('dataset')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const title = useDocumentsTaskRowTitle(task)
  const progress = taskProgress(task)
  const timestamp = Date.parse(taskIsActive(task) ? task.createdAt : taskTime(task))
  const relativeTime = Number.isNaN(timestamp) ? undefined : formatTimeFromNow(timestamp)
  const progressLabel = progress
    ? progress.total > 1
      ? `${progress.completed}/${progress.total}`
      : `${task.progressPercent}%`
    : undefined
  const stateLabel = t(($) => $[`newKnowledge.processingTaskState.${task.state}`], {
    progress: task.progressPercent,
  })
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
  const failureMessageKey = knowledgeFsTaskFailureMessageKey(
    task.failure,
    task.errorCode ?? (task.errorMessage ? 'LEGACY_TASK_FAILURE' : undefined),
  )
  const taskError = failureMessageKey ? t(($) => $[failureMessageKey]) : undefined

  return (
    <>
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
        <p className="mt-0.75 truncate system-xs-regular text-text-tertiary">{status}</p>
        {taskError && (
          <p className="mt-1 system-2xs-regular wrap-break-word whitespace-pre-wrap text-text-destructive">
            {taskError}
          </p>
        )}
      </div>
    </>
  )
}

function DocumentsTaskAction({ task }: { task: BackgroundTask }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const title = useDocumentsTaskRowTitle(task)
  const { canRead, canWrite, includeCancelTarget, includeRetryTarget, knowledgeSpaceId } =
    useAtomValue(taskDrawerActionFactsAtom)
  const onTaskUpdated = useSetAtom(acceptDocumentTaskSnapshotAtom)
  const denyWrite = useSetAtom(denyDocumentWriteAtom)
  const [pending, setPending] = useState(false)
  const [failedLifecycle, setFailedLifecycle] = useState<string>()
  const mountedRef = useRef(true)
  const pendingActionRef = useRef(false)
  const canReadRef = useRef(canRead)
  const taskLifecycleRef = useRef(taskLifecycle(task))
  useEffect(() => {
    canReadRef.current = canRead
    taskLifecycleRef.current = taskLifecycle(task)
  }, [canRead, task])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const cancelTask = useMutation({
    mutationFn: async () =>
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
    mutationFn: async () =>
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
  const refreshDocumentsAndTasks = () => {
    void Promise.allSettled([
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      }),
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
      }),
    ])
  }
  const performAction = async (action: 'cancel' | 'retry') => {
    if (!canWrite || pendingActionRef.current) return
    pendingActionRef.current = true
    const actionLifecycle = taskLifecycle(task)
    const focusTarget = document.activeElement
    const closeButton = taskDrawerCloseButton(focusTarget)
    setPending(true)
    setFailedLifecycle(undefined)
    try {
      const updated =
        action === 'cancel' ? await cancelTask.mutateAsync() : await retryTask.mutateAsync()
      if (
        !mountedRef.current ||
        !canReadRef.current ||
        taskLifecycleRef.current !== actionLifecycle
      )
        return
      if (updated.documentId && updated.documentRevision)
        onTaskUpdated(updated as DocumentProcessingTask)
      if (document.activeElement === focusTarget) closeButton?.focus()
    } catch (error) {
      if (responseStatus(error) === 403) {
        closeButton?.focus()
        denyWrite()
      } else if (
        mountedRef.current &&
        canReadRef.current &&
        taskLifecycleRef.current === actionLifecycle
      ) {
        setFailedLifecycle(actionLifecycle)
      }
    } finally {
      pendingActionRef.current = false
      if (mountedRef.current) {
        setPending(false)
        if (canReadRef.current) refreshDocumentsAndTasks()
      }
    }
  }

  const recoveryPath = knowledgeFsTaskRecoveryPath(task.failure, knowledgeSpaceId)
  const recoveryLabel =
    task.failure?.action === 'configure_model'
      ? tCommon(($) => $['datasetMenus.settings'])
      : task.failure?.action === 'configure_source'
        ? t(($) => $['newKnowledge.openSource'])
        : task.failure?.action === 'reupload'
          ? t(($) => $['newKnowledge.addDocument'])
          : undefined
  const actionTarget = `${title} · ${task.id}`
  if (!canWrite) return null

  const action = taskCanCancel(task) ? 'cancel' : taskCanRetry(task) ? 'retry' : undefined
  if (action)
    return (
      <div className="flex shrink-0 flex-col items-end">
        {failedLifecycle === taskLifecycle(task) && (
          <p className="mt-1 system-2xs-regular text-text-destructive" role="alert">
            {t(($) => $['newKnowledge.taskActionFailed'])}
          </p>
        )}
        <Button
          data-documents-task-action
          aria-label={
            action === 'cancel'
              ? includeCancelTarget
                ? `${t(($) => $['newKnowledge.interruptTask'])} · ${actionTarget}`
                : undefined
              : includeRetryTarget
                ? `${t(($) => $['newKnowledge.retryTask'])} · ${actionTarget}`
                : undefined
          }
          size="small"
          aria-busy={pending}
          disabled={pending}
          loading={pending}
          onClick={() => void performAction(action)}
        >
          {action === 'cancel'
            ? t(($) => $['newKnowledge.interruptTask'])
            : t(($) => $['newKnowledge.retryTask'])}
        </Button>
      </div>
    )

  if (!recoveryPath || !recoveryLabel) return null
  return (
    <Link
      aria-label={`${recoveryLabel} · ${actionTarget}`}
      className={buttonVariants({ size: 'small' })}
      href={recoveryPath}
    >
      {recoveryLabel}
    </Link>
  )
}

function DocumentsTaskRow({ task: baseTask }: { task: BackgroundTask }) {
  const progressStore = useAtomValue(taskProgressStoreAtom)
  const subscribeToProgress = useCallback(
    (listener: () => void) => progressStore.subscribeTask(baseTask.id, listener),
    [baseTask.id, progressStore],
  )
  const getProgress = useCallback(
    () => progressStore.get(baseTask.id),
    [baseTask.id, progressStore],
  )
  const streamedProgress = useSyncExternalStore(subscribeToProgress, getProgress, getProgress)
  const task = useMemo(
    () => taskWithStreamProgress(baseTask, streamedProgress),
    [baseTask, streamedProgress],
  )

  return (
    <li className="flex min-h-15.5 items-center gap-2.5 py-3.5">
      <DocumentsTaskDetails task={task} />
      <DocumentsTaskAction task={task} />
    </li>
  )
}

function DocumentsTaskRows() {
  const { t } = useTranslation('dataset')
  const open = useAtomValue(taskDrawerOpenAtom)
  const orderedTasks = useAtomValue(taskDrawerOrderedBaseTasksAtom)
  const rowsState = useAtomValue(taskDrawerRowsStateAtom)
  const focusedTaskActionRef = useRef<HTMLButtonElement | null>(null)
  const focusedTaskActionCloseRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const focusedAction = focusedTaskActionRef.current
    if (!open || !focusedAction || focusedAction.isConnected) return
    focusedTaskActionRef.current = null
    focusedTaskActionCloseRef.current?.focus()
  }, [open, orderedTasks])

  if (rowsState.isPending && !orderedTasks.length)
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loading />
      </div>
    )

  if (!orderedTasks.length)
    return rowsState.showEmpty ? (
      <p className="py-16 text-center system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.noBackgroundTasks'])}
      </p>
    ) : null

  return (
    <ul
      onBlurCapture={(event) => {
        if (!event.relatedTarget) return
        focusedTaskActionRef.current = null
        focusedTaskActionCloseRef.current = null
      }}
      onFocusCapture={(event) => {
        const action = (event.target as Element).closest<HTMLButtonElement>(
          '[data-documents-task-action]',
        )
        if (!action) return
        focusedTaskActionRef.current = action
        focusedTaskActionCloseRef.current = taskDrawerCloseButton(action) ?? null
      }}
    >
      {orderedTasks.map((task) => {
        return <DocumentsTaskRow key={task.id} task={task} />
      })}
    </ul>
  )
}

function DocumentsTaskLoadMore() {
  const { t } = useTranslation('dataset')
  const open = useAtomValue(taskDrawerOpenAtom)
  const pagination = useAtomValue(taskDrawerLoadMoreFactsAtom)
  const showMore = useSetAtom(showMoreTaskDrawerResultsAtom)
  const loadMoreRequestedRef = useRef(false)
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
  const loadMoreCloseButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) {
      loadMoreRequestedRef.current = false
      return
    }
    if (pagination.hasMore || !loadMoreRequestedRef.current) return
    loadMoreRequestedRef.current = false
    loadMoreCloseButtonRef.current?.focus()
  }, [open, pagination.hasMore])

  if (!pagination.hasMore) return null

  return (
    <div className="mt-4 flex justify-center">
      <Button
        ref={loadMoreButtonRef}
        aria-busy={pagination.fetching}
        loading={pagination.fetching}
        onBlur={() => {
          loadMoreRequestedRef.current = false
        }}
        onClick={(event) => {
          loadMoreRequestedRef.current = document.activeElement === loadMoreButtonRef.current
          loadMoreCloseButtonRef.current = taskDrawerCloseButton(event.currentTarget) ?? null
          showMore()
        }}
      >
        {t(($) => $['newKnowledge.loadMore'])}
      </Button>
    </div>
  )
}

export function DocumentsProcessingTasksDrawer() {
  const open = useAtomValue(taskDrawerOpenAtom)
  const setOpen = useSetAtom(documentTasksOpenAtom)
  const resetResultsWindow = useSetAtom(resetTaskDrawerResultsWindowAtom)

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetResultsWindow()
        setOpen(nextOpen)
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:w-110 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <DocumentsTaskDrawerHeader />
              <div className="min-h-0 flex-1 overflow-y-auto pr-[calc(1.5rem+env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[calc(1.5rem+env(safe-area-inset-left,0px))]">
                <DocumentsTaskQueryRecovery />
                <DocumentsTaskRows />
                <DocumentsTaskLoadMore />
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
