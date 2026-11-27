'use client'

import type { DocumentDisplayStatus } from '../model'
import type { DocumentProcessingTask, LogicalDocument } from '../models'
import type { DocumentRowAction } from '../state/row-actions'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'
import {
  knowledgeFsRequestFailureMessageKey,
  knowledgeFsTaskFailureMessageKey,
} from '../../knowledge-fs-task-error'
import { createRequestId } from '../../request-id'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentTitle,
  taskCanRetry,
} from '../model'
import { backgroundTaskFromApi } from '../models'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentsByIdAtom } from '../state/queries'
import { createDocumentRowCanEditAtom } from '../state/results'
import {
  beginDocumentRowActionAtom,
  createDocumentRowPendingActionAtom,
  finishDocumentRowActionAtom,
} from '../state/row-actions'
import {
  acceptDocumentTaskSnapshotAtom,
  denyDocumentWriteAtom,
  documentCanDownloadAtom,
  ensureDocumentModelReadyAtom,
} from '../state/runtime'
import { removeDocumentFromSelectionAtom } from '../state/selection'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'

export function useDocumentRowPendingAction(documentId: string) {
  const pendingActionAtom = useMemo(
    () => createDocumentRowPendingActionAtom(documentId),
    [documentId],
  )
  return useAtomValue(pendingActionAtom)
}

function useDocumentActionLock(documentId: string, action: DocumentRowAction) {
  const pendingAction = useDocumentRowPendingAction(documentId)
  const beginAction = useSetAtom(beginDocumentRowActionAtom)
  const finishAction = useSetAtom(finishDocumentRowActionAtom)

  return {
    begin: () => beginAction({ action, documentId }),
    busy: Boolean(pendingAction),
    finish: () => finishAction({ action, documentId }),
    pending: pendingAction === action,
  }
}

function useDocumentCanEdit(documentId: string) {
  const canEditAtom = useMemo(() => createDocumentRowCanEditAtom(documentId), [documentId])
  return useAtomValue(canEditAtom)
}

// A conflicting toggle leaves the row out of date; successful writes refresh with the fallback.
function useDocumentInvalidation() {
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const invalidateDocuments = useCallback(() => {
    void Promise.allSettled([
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      }),
      queryClient.invalidateQueries({
        predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key(),
      }),
    ])
  }, [knowledgeSpaceId, queryClient])
  return { invalidateDocuments, knowledgeSpaceId }
}

export function useRenameDocumentAction(document: LogicalDocument) {
  const { t } = useTranslation(['knowledgeSpace'])
  const canEdit = useDocumentCanEdit(document.id)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'rename')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: renameDocument } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const run = useCallback(
    async (title: string) => {
      const normalizedTitle = title.trim()
      if (!canEdit || !normalizedTitle || normalizedTitle === documentTitle(document) || !begin())
        return false
      try {
        await renameDocument({
          body: {
            expectedRowVersion: document.rowVersion,
            patch: { displayName: normalizedTitle },
          },
          params: { control_space_id: knowledgeSpaceId, document_id: document.id },
        })
        return true
      } catch (error) {
        if (getHttpErrorStatus(error) === 403) onWriteDenied()
        else
          toast.error(
            getErrorMessage(error) ?? t(($) => $['settings.saveFailed'], { ns: 'knowledgeSpace' }),
          )
        return false
      } finally {
        finish()
      }
    },
    [begin, canEdit, document, finish, knowledgeSpaceId, onWriteDenied, renameDocument, t],
  )

  return { busy, pending, run }
}

export function useDownloadDocumentAction(
  document: LogicalDocument,
  status: DocumentDisplayStatus,
  documentSnapshotPending: boolean,
) {
  const { t } = useTranslation(['common'])
  const canDownload = useAtomValue(documentCanDownloadAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'download')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: downloadDocument } = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.download.get({
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      }),
  })

  const run = useCallback(async () => {
    if (
      !canDownload ||
      documentSnapshotPending ||
      !documentCanDownload(document, status) ||
      !begin()
    )
      return false
    try {
      const file = await downloadDocument()
      downloadBlob({
        data: file,
        fileName:
          typeof File !== 'undefined' && file instanceof File && file.name
            ? file.name
            : document.title,
      })
      return true
    } catch (error) {
      toast.error(
        getErrorMessage(error) ?? t(($) => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }),
      )
      return false
    } finally {
      finish()
    }
  }, [begin, canDownload, document, downloadDocument, finish, status, t, documentSnapshotPending])

  return { busy, pending, run }
}

export function useToggleDocumentAvailabilityAction(
  document: LogicalDocument,
  status: DocumentDisplayStatus,
) {
  const { t } = useTranslation(['knowledgeSpace'])
  const canEdit = useDocumentCanEdit(document.id)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'toggle-availability')
  const { invalidateDocuments, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: toggleDocument } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.patch.mutationOptions(
      { meta: { errorToast: false } },
    ),
  )

  const run = useCallback(async () => {
    if (!canEdit || !documentCanToggleAvailability(status) || !begin()) return false
    try {
      await toggleDocument({
        body: { enabled: !document.enabled, expectedRowVersion: document.rowVersion },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      })
      return true
    } catch (error) {
      if (getHttpErrorStatus(error) === 403) onWriteDenied()
      else if (getHttpErrorStatus(error) === 409) {
        invalidateDocuments()
        toast.warning(t(($) => $.taskActionFailed))
      } else toast.error(getErrorMessage(error) ?? t(($) => $.documentsErrorDescription))
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canEdit,
    document,
    finish,
    invalidateDocuments,
    knowledgeSpaceId,
    onWriteDenied,
    status,
    t,
    toggleDocument,
  ])

  return { busy, pending, run }
}

export function useRemoveDocumentAction() {
  const { t } = useTranslation(['knowledgeSpace'])
  const store = useStore()
  const onDocumentRemoved = useSetAtom(removeDocumentFromSelectionAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const begin = useSetAtom(beginDocumentRowActionAtom)
  const finish = useSetAtom(finishDocumentRowActionAtom)
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const {
    mutateAsync: removeDocument,
    isPending: pending,
    reset,
  } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete.mutationOptions(
      { meta: { errorToast: false } },
    ),
  )

  const run = async (documentId: string) => {
    const document = store.get(documentsByIdAtom).get(documentId)
    if (!document) {
      onDocumentRemoved(documentId)
      return true
    }
    if (!store.get(createDocumentRowCanEditAtom(documentId))) return false
    const action = { action: 'remove', documentId } as const
    if (!begin(action)) return false
    try {
      await removeDocument({
        body: { expectedRevision: document.rowVersion },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      })
      onDocumentRemoved(documentId)
      return true
    } catch (error) {
      if (getHttpErrorStatus(error) === 403) onWriteDenied()
      else toast.error(getErrorMessage(error) ?? t(($) => $.documentsErrorDescription))
      return false
    } finally {
      finish(action)
    }
  }

  return { pending, run, reset }
}

export function useRetryDocumentTaskAction(
  documentId: string,
  task: DocumentProcessingTask | undefined,
) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tError } = useTranslation(['knowledgeErrors'])
  const describeRequestError = useRequestErrorDescriber()
  const canEdit = useDocumentCanEdit(documentId)
  const onTaskUpdated = useSetAtom(acceptDocumentTaskSnapshotAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(documentId, 'retry')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: retryTask } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post.mutationOptions(
      { meta: { errorToast: false } },
    ),
  )

  const run = useCallback(async () => {
    if (!canEdit || !task || !taskCanRetry(task) || !begin()) return false
    try {
      const updated = backgroundTaskFromApi(
        await retryTask({
          params: {
            control_space_id: knowledgeSpaceId,
            task_id: task.id,
            task_kind: task.taskKind,
          },
        }),
      )
      if (updated.documentId && updated.documentRevision)
        onTaskUpdated(updated as DocumentProcessingTask)
      return true
    } catch (error) {
      if (getHttpErrorStatus(error) === 403) onWriteDenied()
      else {
        const messageKey = await knowledgeFsRequestFailureMessageKey(error)
        toast.error(
          messageKey
            ? tError(($) => $[messageKey])
            : describeRequestError(
                error,
                t(($) => $.taskActionFailed),
              ),
        )
      }
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canEdit,
    describeRequestError,
    finish,
    knowledgeSpaceId,
    onTaskUpdated,
    onWriteDenied,
    retryTask,
    t,
    task,
    tError,
  ])

  return { busy, pending, run }
}

export function useReindexDocumentAction(document: LogicalDocument, status: DocumentDisplayStatus) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeDocuments'])
  const { t: tError } = useTranslation(['knowledgeErrors'])
  const describeRequestError = useRequestErrorDescriber()
  const canEdit = useDocumentCanEdit(document.id)
  const ensureModelReady = useSetAtom(ensureDocumentModelReadyAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'reindex')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: reindexDocument } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const run = useCallback(async () => {
    if (!canEdit || !documentCanReindex(status) || !begin()) return false
    try {
      if ((await ensureModelReady({ capability: 'index', intent: 'reindex' })).status !== 'ready')
        return false
      const result = await reindexDocument({
        body: { documentIds: [document.id] },
        params: { control_space_id: knowledgeSpaceId },
      })
      const item = result.items[0]
      if (!item || item.status === 'not_found')
        toast.error(t(($) => $.documentsReindexPartial, { missing: 1, queued: 0 }))
      else if (item.status === 'disabled' || item.status === 'failed') {
        const messageKey = knowledgeFsTaskFailureMessageKey(undefined, item.code ?? undefined)
        toast.error(
          messageKey
            ? tError(($) => $[messageKey])
            : t(($) => $.documentsReindexFailed, { ns: 'knowledgeDocuments' }),
        )
      } else toast.success(t(($) => $.documentsReindexStarted, { ns: 'knowledgeDocuments' }))
      return true
    } catch (error) {
      if (getHttpErrorStatus(error) === 403) onWriteDenied()
      else {
        const messageKey = await knowledgeFsRequestFailureMessageKey(error)
        toast.error(
          messageKey
            ? tError(($) => $[messageKey])
            : describeRequestError(
                error,
                t(($) => $.documentsReindexFailed, { ns: 'knowledgeDocuments' }),
              ),
        )
      }
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canEdit,
    describeRequestError,
    document.id,
    ensureModelReady,
    finish,
    knowledgeSpaceId,
    onWriteDenied,
    reindexDocument,
    status,
    t,
    tError,
  ])

  return { busy, pending, run }
}
