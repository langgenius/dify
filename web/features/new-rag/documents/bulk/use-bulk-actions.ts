'use client'

import type { DocumentBulkAction } from '../state/bulk'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { createRequestId } from '../../request-id'
import { responseStatus } from '../request-error'
import {
  beginDocumentBulkActionAtom,
  documentBulkPendingActionAtom,
  finishDocumentBulkActionAtom,
} from '../state/bulk'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { selectionResultsUnavailableAtom } from '../state/results'
import {
  denyDocumentWriteAtom,
  documentCanDownloadAtom,
  documentCanWriteAtom,
  ensureDocumentModelReadyAtom,
} from '../state/runtime'
import {
  clearDocumentSelectionAtom,
  downloadableDocumentIdsAtom,
  replaceDocumentSelectionAtom,
  selectedDocumentsAtom,
  selectionAvailabilityDisabledAtom,
  selectionAvailabilityTargetEnabledAtom,
  selectionReindexDisabledAtom,
  validSelectedDocumentIdsAtom,
} from '../state/selection'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'

function useBulkActionLock(action: DocumentBulkAction) {
  const pendingAction = useAtomValue(documentBulkPendingActionAtom)
  const beginAction = useSetAtom(beginDocumentBulkActionAtom)
  const finishAction = useSetAtom(finishDocumentBulkActionAtom)

  return {
    begin: () => beginAction(action),
    busy: Boolean(pendingAction),
    finish: () => finishAction(action),
    pending: pendingAction === action,
  }
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

export function useBulkReindexAction() {
  const { t } = useTranslation('knowledgeSpace')
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectionDisabled = useAtomValue(selectionResultsUnavailableAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const reindexDisabled = useAtomValue(selectionReindexDisabledAtom)
  const ensureModelReady = useSetAtom(ensureDocumentModelReadyAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const replaceSelection = useSetAtom(replaceDocumentSelectionAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('reindex')
  const { invalidateDocumentsAndTasks, knowledgeSpaceId } = useDocumentInvalidation()
  const { mutateAsync: reindexDocuments } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions(),
  )

  const run = useCallback(async () => {
    if (!canWrite || selectionDisabled || !selectedDocumentIds.size || reindexDisabled || !begin())
      return
    try {
      if ((await ensureModelReady({ capability: 'index', intent: 'reindex' })).status !== 'ready')
        return
      const result = await reindexDocuments({
        body: { documentIds: [...selectedDocumentIds].sort() },
        params: { control_space_id: knowledgeSpaceId },
      })
      const missingIds = result.items
        .filter((item) => item.status === 'not_found')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const disabledIds = result.items
        .filter((item) => item.status === 'disabled')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const queuedCount = result.items.filter((item) => item.status === 'queued').length
      replaceSelection(queuedCount ? [...missingIds, ...disabledIds] : disabledIds)
      if (!queuedCount)
        toast.error(
          disabledIds.length
            ? t(($) => $.documentsReindexFailed)
            : t(($) => $.documentsReindexPartial, {
                missing: missingIds.length,
                queued: 0,
              }),
        )
      else if (disabledIds.length) toast.warning(t(($) => $.documentsReindexFailed))
      else if (missingIds.length)
        toast.warning(
          t(($) => $.documentsReindexPartial, {
            missing: missingIds.length,
            queued: queuedCount,
          }),
        )
      else toast.success(t(($) => $.documentsReindexStarted))
      invalidateDocumentsAndTasks()
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $.documentsReindexFailed))
    } finally {
      finish()
    }
  }, [
    begin,
    canWrite,
    ensureModelReady,
    finish,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onWriteDenied,
    reindexDisabled,
    reindexDocuments,
    replaceSelection,
    selectedDocumentIds,
    selectionDisabled,
    t,
  ])

  return { busy, pending, run }
}

export function useBulkDownloadAction() {
  const { t } = useTranslation('common')
  const canDownload = useAtomValue(documentCanDownloadAtom)
  const downloadableDocumentIds = useAtomValue(downloadableDocumentIdsAtom)
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('download')

  const run = useCallback(async () => {
    if (!canDownload || !downloadableDocumentIds.length || !begin()) return
    try {
      const file =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.downloadZip.post({
          body: { document_ids: downloadableDocumentIds },
          params: { control_space_id: knowledgeSpaceId },
        })
      downloadBlob({
        data: file,
        fileName:
          typeof File !== 'undefined' && file instanceof File && file.name
            ? file.name
            : 'knowledge-documents.zip',
      })
    } catch {
      toast.error(t(($) => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }))
    } finally {
      finish()
    }
  }, [begin, canDownload, downloadableDocumentIds, finish, knowledgeSpaceId, t])

  return { busy, pending, run }
}

export function useBulkAvailabilityAction() {
  const { t } = useTranslation('knowledgeSpace')
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectionDisabled = useAtomValue(selectionResultsUnavailableAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const selectedDocuments = useAtomValue(selectedDocumentsAtom)
  const availabilityDisabled = useAtomValue(selectionAvailabilityDisabledAtom)
  const availabilityTargetEnabled = useAtomValue(selectionAvailabilityTargetEnabledAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const replaceSelection = useSetAtom(replaceDocumentSelectionAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('availability')
  const { invalidateDocuments, knowledgeSpaceId } = useDocumentInvalidation()

  const run = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !selectedDocumentIds.size ||
      availabilityDisabled ||
      !selectedDocuments.length ||
      !begin()
    )
      return
    try {
      const result = await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.patch(
        {
          body: {
            documents: selectedDocuments.map((document) => ({
              documentId: document.id,
              expectedRowVersion: document.rowVersion,
            })),
            enabled: availabilityTargetEnabled,
          },
          params: { control_space_id: knowledgeSpaceId },
        },
      )
      const failedIds = result.items.flatMap((item) =>
        item.status === 'conflict' || item.status === 'not_found' ? [item.document_id] : [],
      )
      replaceSelection(failedIds)
      if (failedIds.length) toast.warning(t(($) => $.documentsErrorDescription))
      invalidateDocuments()
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $.documentsErrorDescription))
    } finally {
      finish()
    }
  }, [
    availabilityDisabled,
    availabilityTargetEnabled,
    begin,
    canWrite,
    finish,
    invalidateDocuments,
    knowledgeSpaceId,
    onWriteDenied,
    replaceSelection,
    selectedDocumentIds,
    selectedDocuments,
    selectionDisabled,
    t,
  ])

  return { busy, pending, run }
}

export function useBulkRemoveAction() {
  const { t } = useTranslation('knowledgeSpace')
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectionDisabled = useAtomValue(selectionResultsUnavailableAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const selectedDocuments = useAtomValue(selectedDocumentsAtom)
  const clearSelection = useSetAtom(clearDocumentSelectionAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('remove')
  const { invalidateDocumentsAndTasks, knowledgeSpaceId } = useDocumentInvalidation()

  const run = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !selectedDocumentIds.size ||
      !selectedDocuments.length ||
      !begin()
    )
      return false
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.bulk.delete({
        body: {
          documents: selectedDocuments.map((document) => ({
            documentId: document.id,
            expectedRevision: document.rowVersion,
          })),
        },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId },
      })
      clearSelection()
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
    canWrite,
    clearSelection,
    finish,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onWriteDenied,
    selectedDocumentIds,
    selectedDocuments,
    selectionDisabled,
    t,
  ])

  return { busy, pending, run }
}
