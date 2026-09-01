'use client'

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
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { taskCanCancel, taskCanRetry } from '../../model'
import { logicalDocumentListFromApi } from '../../models'
import {
  selectTaskDrawerTasks,
  TASK_DRAWER_LIMIT,
  taskWithStreamProgress,
} from '../../tasks/drawer-model'
import { createTaskProgressStore } from '../../tasks/progress-store'
import { documentDetailKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentDetailDocumentAtom, refreshDocumentDetailAtom } from '../state/queries'
import {
  documentBackgroundTasksAtom,
  documentCanEditAtom,
  documentTasksQueryErrorAtom,
  documentTasksQueryHasNextPageAtom,
  documentTasksQueryIsFetchingAtom,
  documentTasksQueryIsFetchingNextPageAtom,
  documentTasksQueryIsPendingAtom,
  loadNextDocumentTaskPageAtom,
  refreshDocumentTasksAtom,
  retryDocumentTasksAtom,
} from '../state/workflow'
import { DOCUMENT_TASK_DRAWER_CLOSE_ID, DocumentTaskRow } from './task-row'

const noopSubscribe = () => () => undefined

export function DocumentDetailTasksDrawer({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const currentDocument = useAtomValue(documentDetailDocumentAtom)
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const canEdit = useAtomValue(documentCanEditAtom)
  const tasks = useAtomValue(documentBackgroundTasksAtom)
  const taskQueryError = Boolean(useAtomValue(documentTasksQueryErrorAtom))
  const hasNextTaskPage = useAtomValue(documentTasksQueryHasNextPageAtom)
  const taskQueryFetching = useAtomValue(documentTasksQueryIsFetchingAtom)
  const isFetchingNextTaskPage = useAtomValue(documentTasksQueryIsFetchingNextPageAtom)
  const taskQueryPending = useAtomValue(documentTasksQueryIsPendingAtom)
  const loadMoreTasks = useSetAtom(loadNextDocumentTaskPageAtom)
  const refreshDocument = useSetAtom(refreshDocumentDetailAtom)
  const refreshTasks = useSetAtom(refreshDocumentTasksAtom)
  const retryTasks = useSetAtom(retryDocumentTasksAtom)
  const documentsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.infiniteOptions({
      enabled: open,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
    }),
  )
  const documents = useMemo(() => {
    const queryDocuments =
      documentsQuery.data?.pages.flatMap((page) => logicalDocumentListFromApi(page).items) ?? []
    if (queryDocuments.some((document) => document.id === currentDocument.id)) return queryDocuments
    return [currentDocument, ...queryDocuments]
  }, [currentDocument, documentsQuery.data])
  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents])
  const hasUnresolvedTaskDocuments = tasks.some(
    (task) => task.documentId && !documentIds.has(task.documentId),
  )
  const documentQueryError = Boolean(documentsQuery.error)
  const documentQueryFetching = documentsQuery.isFetching
  const documentsPending = Boolean(documentsQuery.isPending || documentsQuery.hasNextPage)
  const hasNextDocumentPage = Boolean(documentsQuery.hasNextPage)
  const isFetchingNextDocumentPage = documentsQuery.isFetchingNextPage
  const readOnlyReason = canEdit
    ? undefined
    : t(($) => $['newKnowledge.documentPermissionRestricted'])
  const taskProgressStoreRef = useRef<ReturnType<typeof createTaskProgressStore> | null>(null)
  if (!taskProgressStoreRef.current) taskProgressStoreRef.current = createTaskProgressStore()
  const taskProgressStore = taskProgressStoreRef.current
  const refreshDocumentsAndTasks = () =>
    Promise.all([refreshDocument(), documentsQuery.refetch(), refreshTasks()])
  const retryDocuments = () => {
    if (documentsQuery.isFetchNextPageError) return documentsQuery.fetchNextPage()
    return documentsQuery.refetch()
  }
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null)
  const taskQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const documentQueryRetryButtonRef = useRef<HTMLButtonElement>(null)
  const loadMoreRequestedRef = useRef(false)
  const queryRetryFocusRequestedRef = useRef(false)
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
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
    return selectTaskDrawerTasks(tasks, visibleTaskLimit)
  }, [open, tasks, visibleTaskLimit])
  const hasMoreTasks =
    open &&
    (tasks.length > orderedBaseTasks.length ||
      hasNextTaskPage ||
      (hasUnresolvedTaskDocuments && hasNextDocumentPage))
  const orderedTasks = orderedBaseTasks.map((task) =>
    taskWithStreamProgress(task, taskProgressStore.get(task.id)),
  )
  const cancelActionCount = orderedTasks.filter(taskCanCancel).length
  const retryActionCount = orderedTasks.filter(taskCanRetry).length

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

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          loadMoreRequestedRef.current = false
          setVisibleTaskLimit(TASK_DRAWER_LIMIT)
        }
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
                  id={DOCUMENT_TASK_DRAWER_CLOSE_ID}
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
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto pr-[calc(1.5rem+env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[calc(1.5rem+env(safe-area-inset-left,0px))]">
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
                        void retryTasks()
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
                        void retryDocuments()
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
                    {orderedTasks.map((task) => (
                      <DocumentTaskRow
                        key={task.id}
                        cancelActionCount={cancelActionCount}
                        documentTitle={
                          task.documentId ? documentTitles.get(task.documentId) : undefined
                        }
                        documentsPending={documentsPending}
                        onSettled={refreshDocumentsAndTasks}
                        retryActionCount={retryActionCount}
                        task={task}
                      />
                    ))}
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
                          void loadMoreTasks()
                        if (hasUnresolvedTaskDocuments && hasNextDocumentPage)
                          void documentsQuery.fetchNextPage()
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
