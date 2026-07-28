'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { createParser, useQueryState } from 'nuqs'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { datasetDefaultPermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import { DocumentDetailHeader } from './document-detail-header'
import { initialDocumentRevision, responseStatus } from './document-detail-model'
import { DocumentDetailStatus } from './document-detail-status'
import { documentRevisionListFromApi, logicalDocumentFromApi } from './document-models'
import { DocumentRevisionContent } from './document-revision-content'
import { newKnowledgeDocumentsPath } from './routes'
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
  const [selectedRevision, setSelectedRevision] = useQueryState('revision', documentRevisionParser)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const {
    configureModelSetup,
    ensureModelSetupReady,
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
    continueLookup,
    documentMissing,
    isFetchingNextPage: isFetchingNextTaskPage,
    isLookingUp: isLookingUpTask,
    isPending: tasksPending,
    latestTask,
    lookupExhausted,
    permissionRecoveryBusy,
    permissionRecoveryNeeded,
    refetch: refetchTasks,
    recheckTimedOutSubmission,
    reindex,
    reindexBusy,
    retryTimedOutSubmission,
    retryWritePermission,
    submissionPending,
    submissionRecoveryBusy,
    submissionTimedOut,
    taskIsActive,
    tasksError,
    writePermissionRevoked,
  } = useDocumentReindex({
    beforeReindex: ensureModelSetupReady,
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
    <section className="flex min-h-0 flex-1 flex-col px-6 py-5 lg:px-8">
      <DocumentDetailHeader
        backPath={backPath}
        document={document}
        effectiveRevision={effectiveRevision}
        fetchNextRevisionPage={() => void revisionsQuery.fetchNextPage()}
        hasNextRevisionPage={revisionsQuery.hasNextPage}
        isFetchNextRevisionPageError={revisionsQuery.isFetchNextPageError}
        isFetchingNextRevisionPage={revisionsQuery.isFetchingNextPage}
        onReindex={() => void reindex()}
        onRevisionChange={(revision) => void setSelectedRevision(revision)}
        reindexDisabled={
          !canEdit ||
          reindexBusy ||
          submissionPending ||
          taskIsActive ||
          tasksPending ||
          isFetchingNextTaskPage ||
          isLookingUpTask ||
          lookupExhausted ||
          document.status === 'deleting' ||
          Boolean(tasksError)
        }
        reindexDisabledReasonId={!hasEditPermission ? REINDEX_RESTRICTION_ID : undefined}
        reindexing={reindexBusy || submissionPending}
        revisions={availableRevisions}
        taskIsActive={taskIsActive}
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
        locale={locale}
        lookupExhausted={lookupExhausted}
        permissionRecoveryBusy={permissionRecoveryBusy}
        permissionRecoveryNeeded={permissionRecoveryNeeded}
        recheckTimedOutSubmission={recheckTimedOutSubmission}
        refetchRevisions={() => void revisionsQuery.refetch()}
        refetchTasks={() => void refetchTasks()}
        retryTimedOutSubmission={retryTimedOutSubmission}
        retryWritePermission={retryWritePermission}
        revisionHistoryBackgroundError={Boolean(
          revisionsQuery.error && !revisionsQuery.isFetchNextPageError,
        )}
        submissionRecoveryBusy={submissionRecoveryBusy}
        submissionTimedOut={submissionTimedOut}
        taskIsActive={taskIsActive}
        tasksError={Boolean(tasksError)}
        titleRef={titleRef}
      />

      <DocumentRevisionContent
        key={effectiveRevision ?? 'missing'}
        document={document}
        documentId={documentId}
        effectiveRevision={effectiveRevision}
        knowledgeSpaceId={knowledgeSpaceId}
        locale={locale}
        revision={activeRevision}
        revisionHistoryError={Boolean(revisionsQuery.error)}
        revisionHistoryPending={revisionsQuery.isPending}
        retryRevisionHistory={() => void revisionsQuery.refetch()}
      />
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </section>
  )
}
