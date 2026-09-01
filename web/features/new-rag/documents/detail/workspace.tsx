'use client'

import type { LogicalDocument } from '../models'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { newKnowledgeDocumentsPath } from '../../routes'
import { useKnowledgeSpace } from '../../space/context'
import { useDocumentReindex } from '../tasks/use-reindex'
import { DocumentErrorState } from './error-state'
import { DocumentDetailHeader } from './header'
import { DocumentReindexAction } from './reindex-action'
import { DocumentRevisionBrowser } from './revision-browser'
import { DocumentTasksSurface } from './tasks-surface'
import {
  DocumentReindexWorkflowContext,
  DocumentTaskWorkflowContext,
  DocumentWriteAccessContext,
} from './workflow-context'

const REINDEX_RESTRICTION_ID = 'document-reindex-restriction'

export function DocumentDetailWorkspace({
  document,
  documentId,
  documentQueryKey,
  knowledgeSpaceId,
  locale,
  refetchDocument,
}: {
  document: LogicalDocument
  documentId: string
  documentQueryKey: readonly unknown[]
  knowledgeSpaceId: string
  locale: string
  refetchDocument: () => Promise<unknown>
}) {
  const { t } = useTranslation('dataset')
  const { refetch: refetchKnowledgeSpace, space } = useKnowledgeSpace()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const chunksQueryKey =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.revisions.byRevision.chunks.get.key()
  const documentActiveRevision = document.activeRevision ?? document.active?.revision ?? 0
  const workflow = useDocumentReindex({
    chunksQueryKey,
    documentActiveRevision,
    documentId,
    documentQueryKey,
    enabled: true,
    knowledgeSpaceId,
    refreshWritePermission: async () =>
      Boolean(
        (await refetchKnowledgeSpace())?.permission_keys.includes('knowledge_space_document_write'),
      ),
  })
  const hasEditPermission = space.permission_keys.includes('knowledge_space_document_write')
  const canEdit = hasEditPermission && !workflow.writePermissionRevoked
  const reindexInProgress = workflow.submissionPending || workflow.taskIsActive
  const canCancelReindex =
    canEdit &&
    reindexInProgress &&
    (workflow.submissionPending || workflow.latestTask?.canCancel !== false) &&
    !workflow.tasksError
  const writeAccess = useMemo(
    () => ({
      canEdit,
      hasEditPermission,
      permissionRecoveryBusy: workflow.permissionRecoveryBusy,
      permissionRecoveryNeeded: workflow.permissionRecoveryNeeded,
      retryWritePermission: workflow.retryWritePermission,
    }),
    [
      canEdit,
      hasEditPermission,
      workflow.permissionRecoveryBusy,
      workflow.permissionRecoveryNeeded,
      workflow.retryWritePermission,
    ],
  )
  const reindexWorkflow = useMemo(
    () => ({
      canCancel: canCancelReindex,
      cancelBusy: workflow.cancelReindexBusy,
      disabled:
        !canEdit ||
        workflow.reindexBusy ||
        workflow.submissionPending ||
        workflow.taskIsActive ||
        workflow.isPending ||
        workflow.isFetchingNextPage ||
        workflow.isLookingUp ||
        workflow.lookupExhausted ||
        !document.enabled ||
        document.status === 'deleting' ||
        Boolean(workflow.tasksError),
      disabledReasonId: !hasEditPermission ? REINDEX_RESTRICTION_ID : undefined,
      failed: workflow.latestTask?.state === 'failed',
      inProgress: reindexInProgress,
      onCancel: workflow.cancelReindex,
      onReindex: workflow.reindex,
      reindexing: workflow.reindexBusy || workflow.submissionPending,
    }),
    [
      canCancelReindex,
      canEdit,
      document.enabled,
      document.status,
      hasEditPermission,
      reindexInProgress,
      workflow.cancelReindex,
      workflow.cancelReindexBusy,
      workflow.isFetchingNextPage,
      workflow.isLookingUp,
      workflow.isPending,
      workflow.latestTask?.state,
      workflow.lookupExhausted,
      workflow.reindex,
      workflow.reindexBusy,
      workflow.submissionPending,
      workflow.taskIsActive,
      workflow.tasksError,
    ],
  )
  const taskWorkflow = useMemo(
    () => ({
      continueLookup: workflow.continueLookup,
      fetchNextPage: workflow.fetchNextPage,
      hasNextPage: Boolean(workflow.hasNextPage),
      isFetchNextPageError: workflow.isFetchNextPageError,
      isFetching: workflow.isFetching,
      isFetchingNextPage: workflow.isFetchingNextPage,
      isLookingUp: workflow.isLookingUp,
      isPending: workflow.isPending,
      latestTask: workflow.latestTask,
      lookupExhausted: workflow.lookupExhausted,
      refetch: workflow.refetch,
      reindexInProgress,
      tasks: workflow.tasks,
      tasksError: workflow.tasksError,
    }),
    [
      reindexInProgress,
      workflow.continueLookup,
      workflow.fetchNextPage,
      workflow.hasNextPage,
      workflow.isFetchNextPageError,
      workflow.isFetching,
      workflow.isFetchingNextPage,
      workflow.isLookingUp,
      workflow.isPending,
      workflow.latestTask,
      workflow.lookupExhausted,
      workflow.refetch,
      workflow.tasks,
      workflow.tasksError,
    ],
  )

  if (workflow.documentMissing)
    return (
      <DocumentErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  return (
    <DocumentWriteAccessContext value={writeAccess}>
      <DocumentReindexWorkflowContext value={reindexWorkflow}>
        <DocumentTaskWorkflowContext value={taskWorkflow}>
          <section className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-5">
            <KnowledgeModelReadinessBanner
              capability="index"
              className="mb-4"
              knowledgeSpaceId={knowledgeSpaceId}
            />
            <DocumentDetailHeader
              action={
                <DocumentReindexAction key={document.id} knowledgeSpaceId={knowledgeSpaceId} />
              }
              backPath={newKnowledgeDocumentsPath(knowledgeSpaceId)}
              document={document}
              titleRef={titleRef}
            />
            {!hasEditPermission && (
              <p id={REINDEX_RESTRICTION_ID} className="mt-2 system-xs-regular text-text-warning">
                {t(($) => $['newKnowledge.documentPermissionRestricted'])}
              </p>
            )}
            <DocumentTasksSurface
              currentDocument={document}
              knowledgeSpaceId={knowledgeSpaceId}
              refetchDocument={refetchDocument}
              titleRef={titleRef}
            />
            <DocumentRevisionBrowser
              document={document}
              documentId={documentId}
              knowledgeSpaceId={knowledgeSpaceId}
              locale={locale}
            />
          </section>
        </DocumentTaskWorkflowContext>
      </DocumentReindexWorkflowContext>
    </DocumentWriteAccessContext>
  )
}
