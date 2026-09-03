'use client'

import type { DocumentDisplayStatus } from '../model'
import type { DocumentProcessingTask, LogicalDocument } from '../models'
import type { DocumentRowAction } from '../state/row-actions'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { createRequestId } from '../../request-id'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentTitle,
  taskCanRetry,
} from '../model'
import { backgroundTaskFromApi } from '../models'
import { responseStatus } from '../request-error'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { selectionResultsUnavailableAtom } from '../state/results'
import {
  beginDocumentRowActionAtom,
  createDocumentRowPendingActionAtom,
  finishDocumentRowActionAtom,
} from '../state/row-actions'
import {
  acceptDocumentTaskSnapshotAtom,
  denyDocumentWriteAtom,
  documentCanDownloadAtom,
  documentCanWriteAtom,
  ensureDocumentModelReadyAtom,
} from '../state/runtime'
import { removeDocumentFromSelectionAtom } from '../state/selection'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'

function useDocumentActionLock(documentId: string, action: DocumentRowAction) {
  const pendingActionAtom = useMemo(
    () => createDocumentRowPendingActionAtom(documentId),
    [documentId],
  )
  const pendingAction = useAtomValue(pendingActionAtom)
  const beginAction = useSetAtom(beginDocumentRowActionAtom)
  const finishAction = useSetAtom(finishDocumentRowActionAtom)

  return {
    begin: () => beginAction({ action, documentId }),
    busy: Boolean(pendingAction),
    finish: () => finishAction({ action, documentId }),
    pending: pendingAction === action,
  }
}

export function useDocumentRowActionBusy(documentId: string) {
  const pendingActionAtom = useMemo(
    () => createDocumentRowPendingActionAtom(documentId),
    [documentId],
  )
  return Boolean(useAtomValue(pendingActionAtom))
}

function useDocumentCanEdit() {
  const permissionAllowsWrite = useAtomValue(documentCanWriteAtom)
  const selectionResultsUnavailable = useAtomValue(selectionResultsUnavailableAtom)
  return permissionAllowsWrite && !selectionResultsUnavailable
}

function useDocumentInvalidation() {
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const invalidateDocuments = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
      queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
    })
  }, [knowledgeSpaceId, queryClient])
  const invalidateDocumentsAndTasks = useCallback(() => {
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
  }, [knowledgeSpaceId, queryClient])

  return { invalidateDocuments, invalidateDocumentsAndTasks, knowledgeSpaceId }
}

export function useRenameDocumentAction(document: LogicalDocument) {
  const { t } = useTranslation('knowledgeSpace')
  const canEdit = useDocumentCanEdit()
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'rename')
  const { invalidateDocuments, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: renameDocument } = useMutation({
    mutationFn: (title: string) =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
        body: {
          expectedRowVersion: document.rowVersion,
          patch: { displayName: title },
        },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      }),
  })

  const run = useCallback(
    async (title: string) => {
      const normalizedTitle = title.trim()
      if (!canEdit || !normalizedTitle || normalizedTitle === documentTitle(document) || !begin())
        return false
      try {
        await renameDocument(normalizedTitle)
        invalidateDocuments()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) onWriteDenied()
        else toast.error(t(($) => $['settings.saveFailed']))
        return false
      } finally {
        finish()
      }
    },
    [begin, canEdit, document, finish, invalidateDocuments, onWriteDenied, renameDocument, t],
  )

  return { busy, pending, run }
}

export function useDownloadDocumentAction(
  document: LogicalDocument,
  status: DocumentDisplayStatus,
  taskResultsIncomplete: boolean,
) {
  const { t } = useTranslation('common')
  const canDownload = useAtomValue(documentCanDownloadAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'download')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: downloadDocument } = useMutation({
    mutationFn: () =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.download.get({
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      }),
  })

  const run = useCallback(async () => {
    if (!canDownload || taskResultsIncomplete || !documentCanDownload(document, status) || !begin())
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
    } catch {
      toast.error(t(($) => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }))
      return false
    } finally {
      finish()
    }
  }, [begin, canDownload, document, downloadDocument, finish, status, t, taskResultsIncomplete])

  return { busy, pending, run }
}

export function useToggleDocumentAvailabilityAction(
  document: LogicalDocument,
  status: DocumentDisplayStatus,
) {
  const { t } = useTranslation('knowledgeSpace')
  const canEdit = useDocumentCanEdit()
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'toggle-availability')
  const { invalidateDocuments, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: toggleDocument } = useMutation({
    mutationFn: () =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.patch({
        body: { enabled: !document.enabled, expectedRowVersion: document.rowVersion },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      }),
  })

  const run = useCallback(async () => {
    if (!canEdit || !documentCanToggleAvailability(status) || !begin()) return false
    try {
      await toggleDocument()
      invalidateDocuments()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else if (responseStatus(error) === 409) {
        invalidateDocuments()
        toast.warning(t(($) => $.taskActionFailed))
      } else toast.error(t(($) => $.documentsErrorDescription))
      return false
    } finally {
      finish()
    }
  }, [begin, canEdit, finish, invalidateDocuments, onWriteDenied, status, t, toggleDocument])

  return { busy, pending, run }
}

export function useRemoveDocumentAction(document: LogicalDocument) {
  const { t } = useTranslation('knowledgeSpace')
  const canEdit = useDocumentCanEdit()
  const onDocumentRemoved = useSetAtom(removeDocumentFromSelectionAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'remove')
  const { invalidateDocumentsAndTasks, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: removeDocument } = useMutation({
    mutationFn: () =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete({
        body: { expectedRevision: document.rowVersion },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      }),
  })

  const run = useCallback(async () => {
    if (!canEdit || !begin()) return false
    try {
      await removeDocument()
      onDocumentRemoved(document.id)
      invalidateDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $.documentsErrorDescription))
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canEdit,
    document.id,
    finish,
    invalidateDocumentsAndTasks,
    onDocumentRemoved,
    onWriteDenied,
    removeDocument,
    t,
  ])

  return { busy, pending, run }
}

export function useRetryDocumentTaskAction(
  documentId: string,
  task: DocumentProcessingTask | undefined,
) {
  const { t } = useTranslation('knowledgeSpace')
  const canEdit = useDocumentCanEdit()
  const onTaskUpdated = useSetAtom(acceptDocumentTaskSnapshotAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(documentId, 'retry')
  const { invalidateDocumentsAndTasks, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: retryTask } = useMutation({
    mutationFn: async (currentTask: DocumentProcessingTask) =>
      backgroundTaskFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post(
          {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: currentTask.id,
              task_kind: currentTask.taskKind,
            },
          },
        ),
      ),
  })

  const run = useCallback(async () => {
    if (!canEdit || !task || !taskCanRetry(task) || !begin()) return false
    try {
      const updated = await retryTask(task)
      if (updated.documentId && updated.documentRevision)
        onTaskUpdated(updated as DocumentProcessingTask)
      invalidateDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $.taskActionFailed))
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canEdit,
    finish,
    invalidateDocumentsAndTasks,
    onTaskUpdated,
    onWriteDenied,
    retryTask,
    t,
    task,
  ])

  return { busy, pending, run }
}

export function useReindexDocumentAction(document: LogicalDocument, status: DocumentDisplayStatus) {
  const { t } = useTranslation('knowledgeSpace')
  const canEdit = useDocumentCanEdit()
  const ensureModelReady = useSetAtom(ensureDocumentModelReadyAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useDocumentActionLock(document.id, 'reindex')
  const { invalidateDocumentsAndTasks, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: reindexDocument } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions(),
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
      else if (item.status === 'disabled') toast.error(t(($) => $.documentsReindexFailed))
      else toast.success(t(($) => $.documentsReindexStarted))
      invalidateDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $.documentsReindexFailed))
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canEdit,
    document.id,
    ensureModelReady,
    finish,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onWriteDenied,
    reindexDocument,
    status,
    t,
  ])

  return { busy, pending, run }
}
