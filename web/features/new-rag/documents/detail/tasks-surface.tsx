'use client'

import type { RefObject } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { logicalDocumentListFromApi } from '../models'
import { ProcessingTasksDrawer } from '../tasks/drawer'
import { createTaskProgressStore } from '../tasks/progress-store'
import { documentDetailKnowledgeSpaceIdAtom } from './state/inputs'
import { documentDetailDocumentAtom, refreshDocumentDetailAtom } from './state/queries'
import { DocumentPermissionRecoveryNotice, DocumentTaskNotices } from './status'
import { useDocumentTaskWorkflow, useDocumentWriteAccess } from './workflow-context'

export function DocumentTasksSurface({
  titleRef,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const { t } = useTranslation('dataset')
  const currentDocument = useAtomValue(documentDetailDocumentAtom)
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const refreshDocument = useSetAtom(refreshDocumentDetailAtom)
  const {
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetching,
    isFetchingNextPage,
    isPending,
    refetch,
    tasks,
    tasksError,
  } = useDocumentTaskWorkflow()
  const { canEdit, permissionRecoveryBusy, retryWritePermission } = useDocumentWriteAccess()
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
      <DocumentTaskNotices titleRef={titleRef} onViewTasks={() => setOpen(true)} />
      <DocumentPermissionRecoveryNotice titleRef={titleRef} />
      <ProcessingTasksDrawer
        actionResultsValid
        canEdit={canEdit}
        documentQueryError={Boolean(documentsQuery.error)}
        documentQueryFetching={documentsQuery.isFetching}
        documents={documents}
        documentsPending={Boolean(documentsQuery.isPending || documentsQuery.hasNextPage)}
        hasNextDocumentPage={Boolean(documentsQuery.hasNextPage)}
        hasNextTaskPage={hasNextPage}
        hasUnresolvedTaskDocuments={hasUnresolvedTaskDocuments}
        isFetchingNextDocumentPage={documentsQuery.isFetchingNextPage}
        isFetchingNextTaskPage={isFetchingNextPage}
        knowledgeSpaceId={knowledgeSpaceId}
        onLoadMoreDocuments={() => void documentsQuery.fetchNextPage()}
        onLoadMoreTasks={() => void fetchNextPage()}
        onOpenChange={setOpen}
        onRefreshDocumentsAndTasks={() => {
          void Promise.all([refreshDocument(), documentsQuery.refetch(), refetch()])
        }}
        onRetryDocumentQuery={() => {
          if (documentsQuery.isFetchNextPageError) void documentsQuery.fetchNextPage()
          else void documentsQuery.refetch()
        }}
        onRetryPermissionQuery={() => void retryWritePermission()}
        onRetryTaskQuery={() => {
          if (isFetchNextPageError) void fetchNextPage()
          else void refetch()
        }}
        onTaskUpdated={() => void refetch()}
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
        taskQueryFetching={isFetching}
        taskQueryPending={isPending}
        tasks={tasks}
      />
    </>
  )
}
