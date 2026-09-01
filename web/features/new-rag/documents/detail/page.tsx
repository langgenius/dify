'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { KnowledgeModelSetupDialog } from '../../components/knowledge-model-setup-dialog'
import { newKnowledgeDocumentsPath } from '../../routes'
import { useKnowledgeSpace } from '../../space/context'
import { useKnowledgeModelSetupGuard } from '../../use-knowledge-model-setup-guard'
import { logicalDocumentFromApi } from '../models'
import { useDocumentReindex } from '../tasks/use-reindex'
import { DocumentDetailHeader } from './header'
import { responseStatus } from './model'
import { DocumentRevisionBrowser } from './revision-browser'
import { DocumentTasksSurface } from './tasks-surface'

const REINDEX_RESTRICTION_ID = 'document-reindex-restriction'

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
  const { refetch: refetchKnowledgeSpace, space } = useKnowledgeSpace()
  const titleRef = useRef<HTMLHeadingElement>(null)
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
    refreshWritePermission: async () =>
      Boolean(
        (await refetchKnowledgeSpace())?.permission_keys.includes('knowledge_space_document_write'),
      ),
  })
  const hasEditPermission = space.permission_keys.includes('knowledge_space_document_write')
  const canEdit = hasEditPermission && !writePermissionRevoked
  const reindexInProgress = submissionPending || taskIsActive
  const canCancelReindex =
    canEdit &&
    reindexInProgress &&
    (submissionPending || latestTask?.canCancel !== false) &&
    !tasksError
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
        onCancelReindex={() => void cancelReindex()}
        onReindex={() => void reindex()}
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
        titleRef={titleRef}
      />
      {!hasEditPermission && (
        <p id={REINDEX_RESTRICTION_ID} className="mt-2 system-xs-regular text-text-warning">
          {t(($) => $['newKnowledge.documentPermissionRestricted'])}
        </p>
      )}

      <DocumentTasksSurface
        actionResultsValid={!documentMissing}
        canEdit={canEdit}
        continueLookup={continueLookup}
        currentDocument={document}
        fetchNextTaskPage={fetchNextTaskPage}
        hasNextTaskPage={Boolean(hasNextTaskPage)}
        isFetchNextTaskPageError={isFetchNextTaskPageError}
        isFetchingNextTaskPage={isFetchingNextTaskPage}
        isLookingUpTask={isLookingUpTask}
        knowledgeSpaceId={knowledgeSpaceId}
        latestTask={latestTask}
        lookupExhausted={lookupExhausted}
        permissionRecoveryBusy={permissionRecoveryBusy}
        permissionRecoveryNeeded={permissionRecoveryNeeded}
        refetchDocument={documentQuery.refetch}
        refetchTasks={refetchTasks}
        reindexInProgress={reindexInProgress}
        retryWritePermission={retryWritePermission}
        taskQueryFetching={tasksFetching}
        taskQueryPending={tasksPending}
        tasks={tasks}
        tasksError={tasksError}
        titleRef={titleRef}
      />

      <DocumentRevisionBrowser
        canEdit={canEdit}
        document={document}
        documentId={documentId}
        knowledgeSpaceId={knowledgeSpaceId}
        locale={locale}
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
