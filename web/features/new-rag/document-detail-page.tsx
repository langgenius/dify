'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { createParser, parseAsString, useQueryStates } from 'nuqs'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { datasetDefaultPermissionKeysAtom } from '@/context/permission-state'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeModelReadinessBanner } from './components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import { DocumentDetailHeader } from './document-detail-header'
import { initialDocumentRevision, responseStatus } from './document-detail-model'
import { DocumentDetailStatus } from './document-detail-status'
import {
  documentRevisionListFromApi,
  logicalDocumentFromApi,
  logicalDocumentListFromApi,
} from './document-models'
import { DocumentRevisionContent } from './document-revision-content'
import { ProcessingTasksDrawer } from './processing-tasks-drawer'
import { newKnowledgeDocumentsPath } from './routes'
import { createTaskProgressStore } from './task-progress-store'
import { useDocumentReindex } from './use-document-reindex'
import { useKnowledgeModelSetupGuard } from './use-knowledge-model-setup-guard'

const REINDEX_RESTRICTION_ID = 'document-reindex-restriction'
const documentRevisionParser = createParser<number>({
  parse: (value) => {
    const revision = Number(value)
    return Number.isInteger(revision) && revision > 0 ? revision : null
  },
  serialize: String,
}).withOptions({ history: 'push' })
const documentChunkParser = parseAsString.withOptions({ history: 'replace' })

function ErrorState({
  description,
  onRetry,
  title,
}: {
  description: string
  onRetry?: () => void
  title: string
}) {
  const { t: tCommon } = useTranslation('common')
  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
      <span aria-hidden className="i-ri-error-warning-line size-8 text-text-destructive" />
      <h1 className="mt-3 title-2xl-semi-bold text-text-primary">{title}</h1>
      <p className="mt-2 max-w-lg body-sm-regular text-text-tertiary">{description}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
    </div>
  )
}

export function DocumentDetailPage({
  documentId,
  knowledgeSpaceId,
}: {
  documentId: string
  knowledgeSpaceId: string
}) {
  const { i18n, t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const permissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const [documentLocation, setDocumentLocation] = useQueryStates({
    chunk: documentChunkParser,
    revision: documentRevisionParser,
  })
  const { chunk: selectedChunkId, revision: selectedRevision } = documentLocation
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const taskProgressStoreRef = useRef<ReturnType<typeof createTaskProgressStore> | null>(null)
  if (!taskProgressStoreRef.current) taskProgressStoreRef.current = createTaskProgressStore()
  const taskProgressStore = taskProgressStoreRef.current
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)

  const documentQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.get.queryOptions(
        {
          input: {
            params: {
              control_space_id: knowledgeSpaceId,
              document_id: documentId,
            },
          },
          retry: (failureCount, error) => {
            const status = responseStatus(error)
            return status !== 403 && status !== 404 && failureCount < 2
          },
          select: logicalDocumentFromApi,
        },
      ),
    [documentId, knowledgeSpaceId],
  )
  const documentQuery = useQuery(documentQueryOptions)
  const knowledgeSpaceQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const documentTitle = documentQuery.data?.title ?? t(($) => $['newKnowledge.documents'])
  const knowledgeSpaceTitle =
    knowledgeSpaceQuery.data?.technical_summary?.name ?? t(($) => $.knowledge)
  useDocumentTitle(`${documentTitle} · ${knowledgeSpaceTitle}`)
  const taskDocumentsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.infiniteOptions({
      enabled: tasksDrawerOpen,
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
  const revisionsQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.get.infiniteOptions(
        {
          input: (pageParam) => ({
            params: {
              control_space_id: knowledgeSpaceId,
              document_id: documentId,
            },
            query: {
              ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
            },
          }),
          getNextPageParam: (lastPage) => lastPage.next_cursor,
          initialPageParam: null as string | null,
        },
      ),
    [documentId, knowledgeSpaceId],
  )
  const revisionsQuery = useInfiniteQuery(revisionsQueryOptions)
  const revisions = useMemo(
    () =>
      revisionsQuery.data?.pages.flatMap((page) => documentRevisionListFromApi(page).items) ?? [],
    [revisionsQuery.data],
  )
  const availableRevisions = useMemo(() => {
    const byRevision = new Map(revisions.map((revision) => [revision.revision, revision]))
    if (documentQuery.data?.active)
      byRevision.set(documentQuery.data.active.revision, documentQuery.data.active)
    return [...byRevision.values()].sort((left, right) => right.revision - left.revision)
  }, [documentQuery.data?.active, revisions])
  const effectiveRevision = documentQuery.data
    ? (selectedRevision ?? initialDocumentRevision(documentQuery.data, availableRevisions))
    : undefined
  const chunksQueryKey =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.byRevision.chunks.get.key()
  const documentActiveRevision =
    documentQuery.data?.activeRevision ?? documentQuery.data?.active?.revision ?? 0
  const documentErrorStatus = responseStatus(documentQuery.error)
  const {
    cancelReindex,
    cancelReindexBusy,
    continueLookup,
    documentMissing,
    fetchNextPage: fetchNextTaskPage,
    hasNextPage: hasNextTaskPage,
    isFetchNextPageError: isFetchNextTaskPageError,
    isFetching: tasksFetching,
    isFetchingNextPage: isFetchingNextTaskPage,
    isLookingUp: isLookingUpTask,
    isPending: tasksPending,
    latestTask,
    lookupExhausted,
    permissionRecoveryBusy,
    permissionRecoveryNeeded,
    refetch: refetchTasks,
    reindex,
    reindexBusy,
    retryWritePermission,
    submissionPending,
    taskIsActive,
    tasks,
    tasksError,
    writePermissionRevoked,
  } = useDocumentReindex({
    beforeReindex: async () =>
      (await ensureModelReady({ capability: 'index', intent: 'reindex' })).status === 'ready',
    documentActiveRevision,
    chunksQueryKey,
    documentId,
    documentQueryKey: documentQueryOptions.queryKey,
    enabled:
      Boolean(documentQuery.data) && documentErrorStatus !== 403 && documentErrorStatus !== 404,
    knowledgeSpaceId,
    revisionsQueryKey: revisionsQueryOptions.queryKey,
  })
  const hasEditPermission = hasPermission(permissionKeys, DatasetACLPermission.Edit)
  const canEdit = hasEditPermission && !writePermissionRevoked
  const reindexInProgress = submissionPending || taskIsActive
  const canCancelReindex =
    canEdit &&
    reindexInProgress &&
    (submissionPending || latestTask?.canCancel !== false) &&
    !tasksError
  const taskDocuments = useMemo(() => {
    const documents =
      taskDocumentsQuery.data?.pages.flatMap((page) => logicalDocumentListFromApi(page).items) ?? []
    if (documentQuery.data && !documents.some((document) => document.id === documentQuery.data?.id))
      return [documentQuery.data, ...documents]
    return documents
  }, [documentQuery.data, taskDocumentsQuery.data])
  const taskDocumentIds = useMemo(
    () => new Set(taskDocuments.map((document) => document.id)),
    [taskDocuments],
  )
  const hasUnresolvedTaskDocuments = tasks.some(
    (task) => task.documentId && !taskDocumentIds.has(task.documentId),
  )
  const activeRevision = availableRevisions.find(
    (revision) => revision.revision === effectiveRevision,
  )
  const backPath = newKnowledgeDocumentsPath(knowledgeSpaceId)
  const locale = i18n.resolvedLanguage ?? i18n.language

  if (documentQuery.isPending)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loading />
        <span className="sr-only">{tCommon(($) => $.loading)}</span>
      </div>
    )

  if (documentMissing || documentErrorStatus === 403 || documentErrorStatus === 404)
    return (
      <ErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  if (!documentQuery.data) {
    return (
      <ErrorState
        description={t(($) => $['newKnowledge.documentLoadErrorDescription'])}
        onRetry={() => void documentQuery.refetch()}
        title={t(($) => $['newKnowledge.documentLoadErrorTitle'])}
      />
    )
  }

  const document = documentQuery.data
  return (
    <section className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-5">
      <KnowledgeModelReadinessBanner
        capability="index"
        className="mb-4"
        knowledgeSpaceId={knowledgeSpaceId}
      />
      <DocumentDetailHeader
        backPath={backPath}
        canCancelReindex={canCancelReindex}
        cancelReindexBusy={cancelReindexBusy}
        document={document}
        effectiveRevision={effectiveRevision}
        fetchNextRevisionPage={() => void revisionsQuery.fetchNextPage()}
        hasNextRevisionPage={revisionsQuery.hasNextPage}
        isFetchNextRevisionPageError={revisionsQuery.isFetchNextPageError}
        isFetchingNextRevisionPage={revisionsQuery.isFetchingNextPage}
        onCancelReindex={() => void cancelReindex()}
        onReindex={() => void reindex()}
        onRevisionChange={(revision) => void setDocumentLocation({ chunk: null, revision })}
        reindexDisabled={
          !canEdit ||
          reindexBusy ||
          submissionPending ||
          taskIsActive ||
          tasksPending ||
          isFetchingNextTaskPage ||
          isLookingUpTask ||
          lookupExhausted ||
          !document.enabled ||
          document.status === 'deleting' ||
          Boolean(tasksError)
        }
        reindexDisabledReasonId={!hasEditPermission ? REINDEX_RESTRICTION_ID : undefined}
        reindexFailed={latestTask?.state === 'failed'}
        reindexInProgress={reindexInProgress}
        reindexing={reindexBusy || submissionPending}
        revisions={availableRevisions}
        titleRef={titleRef}
      />
      {!hasEditPermission && (
        <p id={REINDEX_RESTRICTION_ID} className="mt-2 system-xs-regular text-text-warning">
          {t(($) => $['newKnowledge.documentPermissionRestricted'])}
        </p>
      )}

      <DocumentDetailStatus
        continueLookup={continueLookup}
        effectiveRevision={effectiveRevision}
        isLookingUpTask={isLookingUpTask}
        latestTask={latestTask}
        lookupExhausted={lookupExhausted}
        permissionRecoveryBusy={permissionRecoveryBusy}
        permissionRecoveryNeeded={permissionRecoveryNeeded}
        refetchRevisions={() => void revisionsQuery.refetch()}
        refetchTasks={() => void refetchTasks()}
        retryWritePermission={retryWritePermission}
        reindexInProgress={reindexInProgress}
        revisionHistoryBackgroundError={Boolean(
          revisionsQuery.error && !revisionsQuery.isFetchNextPageError,
        )}
        tasksError={Boolean(tasksError)}
        titleRef={titleRef}
        onViewTasks={() => setTasksDrawerOpen(true)}
      />

      <ProcessingTasksDrawer
        actionResultsValid={!documentMissing}
        canEdit={canEdit}
        documentQueryError={Boolean(taskDocumentsQuery.error)}
        documentQueryFetching={taskDocumentsQuery.isFetching}
        documents={taskDocuments}
        documentsPending={Boolean(taskDocumentsQuery.isPending || taskDocumentsQuery.hasNextPage)}
        hasNextDocumentPage={Boolean(taskDocumentsQuery.hasNextPage)}
        hasNextTaskPage={Boolean(hasNextTaskPage)}
        hasUnresolvedTaskDocuments={hasUnresolvedTaskDocuments}
        isFetchingNextDocumentPage={taskDocumentsQuery.isFetchingNextPage}
        isFetchingNextTaskPage={isFetchingNextTaskPage}
        knowledgeSpaceId={knowledgeSpaceId}
        onLoadMoreDocuments={() => void taskDocumentsQuery.fetchNextPage()}
        onLoadMoreTasks={() => void fetchNextTaskPage()}
        onOpenChange={setTasksDrawerOpen}
        onRefreshDocumentsAndTasks={() => {
          void Promise.all([documentQuery.refetch(), taskDocumentsQuery.refetch(), refetchTasks()])
        }}
        onRetryDocumentQuery={() => {
          if (taskDocumentsQuery.isFetchNextPageError) void taskDocumentsQuery.fetchNextPage()
          else void taskDocumentsQuery.refetch()
        }}
        onRetryPermissionQuery={() => void retryWritePermission()}
        onRetryTaskQuery={() => {
          if (isFetchNextTaskPageError) void fetchNextTaskPage()
          else void refetchTasks()
        }}
        onTaskUpdated={() => void refetchTasks()}
        onWritePermissionDenied={() => void retryWritePermission()}
        open={tasksDrawerOpen}
        permissionQueryError={false}
        permissionQueryFetching={permissionRecoveryBusy}
        permissionQueryPending={false}
        readOnlyReason={
          canEdit ? undefined : t(($) => $['newKnowledge.documentPermissionRestricted'])
        }
        taskProgressStore={taskProgressStore}
        taskQueryError={Boolean(tasksError)}
        taskQueryFetching={tasksFetching}
        taskQueryPending={tasksPending}
        tasks={tasks}
      />

      <DocumentRevisionContent
        key={effectiveRevision ?? 'missing'}
        canEdit={canEdit}
        document={document}
        documentId={documentId}
        effectiveRevision={effectiveRevision}
        knowledgeSpaceId={knowledgeSpaceId}
        locale={locale}
        onSelectChunk={(chunkId) => void setDocumentLocation({ chunk: chunkId })}
        revision={activeRevision}
        revisionHistoryError={Boolean(revisionsQuery.error)}
        revisionHistoryPending={revisionsQuery.isPending}
        retryRevisionHistory={() => void revisionsQuery.refetch()}
        selectedChunkId={selectedChunkId ?? undefined}
      />
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </section>
  )
}
