'use client'

import type { DocumentBulkAction } from '../state/bulk'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback } from 'react'
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
  beginDocumentBulkActionAtom,
  documentBulkPendingActionAtom,
  finishDocumentBulkActionAtom,
} from '../state/bulk'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import {
  denyDocumentWriteAtom,
  documentCanDownloadAtom,
  documentCanWriteAtom,
  ensureDocumentModelReadyAtom,
} from '../state/runtime'
import {
  documentSelectionLimitExceededAtom,
  downloadableDocumentIdsAtom,
  replaceDocumentSelectionAtom,
  selectedDocumentResultsUnavailableAtom,
  selectedDocumentsAtom,
  selectionAvailabilityDisabledAtom,
  selectionAvailabilityTargetEnabledAtom,
  selectionReindexDisabledAtom,
  validSelectedDocumentIdsAtom,
} from '../state/selection'

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

export function useBulkReindexAction() {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeDocuments'])
  const { t: tError } = useTranslation(['knowledgeErrors'])
  const describeRequestError = useRequestErrorDescriber()
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectionDisabled = useAtomValue(selectedDocumentResultsUnavailableAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const reindexDisabled = useAtomValue(selectionReindexDisabledAtom)
  const ensureModelReady = useSetAtom(ensureDocumentModelReadyAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const replaceSelection = useSetAtom(replaceDocumentSelectionAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('reindex')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: reindexDocuments } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions({
      meta: { errorToast: false },
    }),
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
      const failedIds = result.items
        .filter((item) => item.status === 'disabled' || item.status === 'failed')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const queuedCount = result.items.filter((item) => item.status === 'queued').length
      const failureMessageKey = result.items
        .filter((item) => item.status === 'failed')
        .map((item) => knowledgeFsTaskFailureMessageKey(undefined, item.code ?? undefined))
        .find((messageKey) => messageKey !== undefined)
      const failureMessage = failureMessageKey
        ? tError(($) => $[failureMessageKey])
        : t(($) => $.documentsReindexFailed, { ns: 'knowledgeDocuments' })
      replaceSelection(queuedCount ? [...missingIds, ...failedIds] : failedIds)
      if (!queuedCount)
        toast.error(
          failedIds.length
            ? failureMessage
            : t(($) => $.documentsReindexPartial, {
                missing: missingIds.length,
                queued: 0,
              }),
        )
      else if (failedIds.length) toast.warning(failureMessage)
      else if (missingIds.length)
        toast.warning(
          t(($) => $.documentsReindexPartial, {
            missing: missingIds.length,
            queued: queuedCount,
          }),
        )
      else toast.success(t(($) => $.documentsReindexStarted, { ns: 'knowledgeDocuments' }))
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
    } finally {
      finish()
    }
  }, [
    begin,
    canWrite,
    describeRequestError,
    ensureModelReady,
    finish,
    knowledgeSpaceId,
    onWriteDenied,
    reindexDisabled,
    reindexDocuments,
    replaceSelection,
    selectedDocumentIds,
    selectionDisabled,
    t,
    tError,
  ])

  return { busy, pending, run }
}

export function useBulkDownloadAction() {
  const { t } = useTranslation(['common'])
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
    } catch (error) {
      toast.error(
        getErrorMessage(error) ?? t(($) => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }),
      )
    } finally {
      finish()
    }
  }, [begin, canDownload, downloadableDocumentIds, finish, knowledgeSpaceId, t])

  return { busy, pending, run }
}

export function useBulkAvailabilityAction() {
  const { t } = useTranslation(['knowledgeSpace'])
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectionDisabled = useAtomValue(selectedDocumentResultsUnavailableAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const selectedDocuments = useAtomValue(selectedDocumentsAtom)
  const availabilityDisabled = useAtomValue(selectionAvailabilityDisabledAtom)
  const availabilityTargetEnabled = useAtomValue(selectionAvailabilityTargetEnabledAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const replaceSelection = useSetAtom(replaceDocumentSelectionAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('availability')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: updateDocuments } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )

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
      const result = await updateDocuments({
        body: {
          documents: selectedDocuments.map((document) => ({
            documentId: document.id,
            expectedRowVersion: document.rowVersion,
          })),
          enabled: availabilityTargetEnabled,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      const failedIds = result.items.flatMap((item) =>
        item.status === 'conflict' || item.status === 'not_found' ? [item.document_id] : [],
      )
      replaceSelection(failedIds)
      if (failedIds.length) toast.warning(t(($) => $.documentsErrorDescription))
    } catch (error) {
      if (getHttpErrorStatus(error) === 403) onWriteDenied()
      else toast.error(getErrorMessage(error) ?? t(($) => $.documentsErrorDescription))
    } finally {
      finish()
    }
  }, [
    availabilityDisabled,
    availabilityTargetEnabled,
    begin,
    canWrite,
    finish,
    knowledgeSpaceId,
    onWriteDenied,
    replaceSelection,
    selectedDocumentIds,
    selectedDocuments,
    selectionDisabled,
    t,
    updateDocuments,
  ])

  return { busy, pending, run }
}

export function useBulkRemoveAction() {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeDocuments'])
  const canWrite = useAtomValue(documentCanWriteAtom)
  const selectionDisabled = useAtomValue(selectedDocumentResultsUnavailableAtom)
  const selectedDocumentIds = useAtomValue(validSelectedDocumentIdsAtom)
  const selectedDocuments = useAtomValue(selectedDocumentsAtom)
  const selectionLimitExceeded = useAtomValue(documentSelectionLimitExceededAtom)
  const onWriteDenied = useSetAtom(denyDocumentWriteAtom)
  const replaceSelection = useSetAtom(replaceDocumentSelectionAtom)
  const { begin, busy, finish, pending } = useBulkActionLock('remove')
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const { mutateAsync: removeDocuments } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.bulk.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const run = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !selectedDocumentIds.size ||
      !selectedDocuments.length ||
      selectionLimitExceeded ||
      !begin()
    )
      return false
    try {
      const result = await removeDocuments({
        body: {
          documents: selectedDocuments.map((document) => ({
            documentId: document.id,
            expectedRevision: document.rowVersion,
          })),
        },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId },
      })
      const rejectedIds = (result.results ?? []).flatMap((item) =>
        item.status === 'rejected' ? [item.document_id] : [],
      )
      replaceSelection(rejectedIds)
      if (rejectedIds.length) {
        const message = t(($) => $.documentsRemovePartial, {
          ns: 'knowledgeDocuments',
          rejected: rejectedIds.length,
          removed: selectedDocuments.length - rejectedIds.length,
        })
        if (rejectedIds.length === selectedDocuments.length) toast.error(message)
        else toast.warning(message)
      }
      return true
    } catch (error) {
      if (getHttpErrorStatus(error) === 403) onWriteDenied()
      else toast.error(getErrorMessage(error) ?? t(($) => $.documentsErrorDescription))
      return false
    } finally {
      finish()
    }
  }, [
    begin,
    canWrite,
    finish,
    knowledgeSpaceId,
    onWriteDenied,
    removeDocuments,
    replaceSelection,
    selectedDocumentIds,
    selectedDocuments,
    selectionDisabled,
    selectionLimitExceeded,
    t,
  ])

  return { busy, pending, run }
}
