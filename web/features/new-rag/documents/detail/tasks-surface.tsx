'use client'

import type { RefObject } from 'react'
import type { BackgroundTask, DocumentProcessingTask, LogicalDocument } from '../models'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { logicalDocumentListFromApi } from '../models'
import { ProcessingTasksDrawer } from '../tasks/drawer'
import { createTaskProgressStore } from '../tasks/progress-store'
import { DocumentDetailStatus } from './status'

export function DocumentTasksSurface({
  actionResultsValid,
  canEdit,
  continueLookup,
  currentDocument,
  fetchNextTaskPage,
  hasNextTaskPage,
  isFetchNextTaskPageError,
  isFetchingNextTaskPage,
  isLookingUpTask,
  knowledgeSpaceId,
  latestTask,
  lookupExhausted,
  permissionRecoveryBusy,
  permissionRecoveryNeeded,
  refetchDocument,
  refetchTasks,
  reindexInProgress,
  retryWritePermission,
  taskQueryFetching,
  taskQueryPending,
  tasks,
  tasksError,
  titleRef,
}: {
  actionResultsValid: boolean
  canEdit: boolean
  continueLookup: () => void
  currentDocument: LogicalDocument
  fetchNextTaskPage: () => Promise<unknown>
  hasNextTaskPage: boolean
  isFetchNextTaskPageError: boolean
  isFetchingNextTaskPage: boolean
  isLookingUpTask: boolean
  knowledgeSpaceId: string
  latestTask?: DocumentProcessingTask
  lookupExhausted: boolean
  permissionRecoveryBusy: boolean
  permissionRecoveryNeeded: boolean
  refetchDocument: () => Promise<unknown>
  refetchTasks: () => Promise<unknown>
  reindexInProgress: boolean
  retryWritePermission: () => Promise<boolean>
  taskQueryFetching: boolean
  taskQueryPending: boolean
  tasks: BackgroundTask[]
  tasksError: unknown
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const { t } = useTranslation('dataset')
  const [open, setOpen] = useState(false)
  const taskProgressStoreRef = useRef<ReturnType<typeof createTaskProgressStore> | null>(null)
  if (!taskProgressStoreRef.current) taskProgressStoreRef.current = createTaskProgressStore()
  const taskProgressStore = taskProgressStoreRef.current
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

  return (
    <>
      <DocumentDetailStatus
        continueLookup={continueLookup}
        isLookingUpTask={isLookingUpTask}
        latestTask={latestTask}
        lookupExhausted={lookupExhausted}
        permissionRecoveryBusy={permissionRecoveryBusy}
        permissionRecoveryNeeded={permissionRecoveryNeeded}
        refetchTasks={() => void refetchTasks()}
        reindexInProgress={reindexInProgress}
        retryWritePermission={retryWritePermission}
        tasksError={Boolean(tasksError)}
        titleRef={titleRef}
        onViewTasks={() => setOpen(true)}
      />
      <ProcessingTasksDrawer
        actionResultsValid={actionResultsValid}
        canEdit={canEdit}
        documentQueryError={Boolean(documentsQuery.error)}
        documentQueryFetching={documentsQuery.isFetching}
        documents={documents}
        documentsPending={Boolean(documentsQuery.isPending || documentsQuery.hasNextPage)}
        hasNextDocumentPage={Boolean(documentsQuery.hasNextPage)}
        hasNextTaskPage={hasNextTaskPage}
        hasUnresolvedTaskDocuments={hasUnresolvedTaskDocuments}
        isFetchingNextDocumentPage={documentsQuery.isFetchingNextPage}
        isFetchingNextTaskPage={isFetchingNextTaskPage}
        knowledgeSpaceId={knowledgeSpaceId}
        onLoadMoreDocuments={() => void documentsQuery.fetchNextPage()}
        onLoadMoreTasks={() => void fetchNextTaskPage()}
        onOpenChange={setOpen}
        onRefreshDocumentsAndTasks={() => {
          void Promise.all([refetchDocument(), documentsQuery.refetch(), refetchTasks()])
        }}
        onRetryDocumentQuery={() => {
          if (documentsQuery.isFetchNextPageError) void documentsQuery.fetchNextPage()
          else void documentsQuery.refetch()
        }}
        onRetryPermissionQuery={() => void retryWritePermission()}
        onRetryTaskQuery={() => {
          if (isFetchNextTaskPageError) void fetchNextTaskPage()
          else void refetchTasks()
        }}
        onTaskUpdated={() => void refetchTasks()}
        onWritePermissionDenied={() => void retryWritePermission()}
        open={open}
        permissionQueryError={false}
        permissionQueryFetching={permissionRecoveryBusy}
        permissionQueryPending={false}
        readOnlyReason={
          canEdit ? undefined : t(($) => $['newKnowledge.documentPermissionRestricted'])
        }
        taskProgressStore={taskProgressStore}
        taskQueryError={Boolean(tasksError)}
        taskQueryFetching={taskQueryFetching}
        taskQueryPending={taskQueryPending}
        tasks={tasks}
      />
    </>
  )
}
