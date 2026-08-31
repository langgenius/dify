'use client'

import type { EnsureKnowledgeModelReady } from '../../use-knowledge-model-setup-guard'
import type { DocumentBulkSelection } from './selection-state'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { createRequestId } from '../../request-id'
import { responseStatus } from '../request-error'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'

export type DocumentBulkAction = 'availability' | 'download' | 'reindex' | 'remove'

export function useDocumentBulkActions({
  canDownload,
  canWrite,
  ensureModelReady,
  knowledgeSpaceId,
  onWriteDenied,
  selection,
  selectionDisabled,
}: {
  canDownload: boolean
  canWrite: boolean
  ensureModelReady: EnsureKnowledgeModelReady
  knowledgeSpaceId: string
  onWriteDenied: () => void
  selection: DocumentBulkSelection
  selectionDisabled: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const pendingRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<DocumentBulkAction>()
  const { mutateAsync: reindexDocuments } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.reindex.post.mutationOptions(),
  )

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

  const beginAction = useCallback((action: DocumentBulkAction) => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPendingAction(action)
    return true
  }, [])

  const finishAction = useCallback(() => {
    pendingRef.current = false
    setPendingAction(undefined)
  }, [])

  const reindex = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !selection.selectedDocumentIds.size ||
      selection.reindexDisabled ||
      !beginAction('reindex')
    )
      return
    try {
      if ((await ensureModelReady({ capability: 'index', intent: 'reindex' })).status !== 'ready')
        return
      const selectedIds = [...selection.selectedDocumentIds].sort()
      const result = await reindexDocuments({
        body: { documentIds: selectedIds },
        params: { control_space_id: knowledgeSpaceId },
      })
      const missingIds = result.items
        .filter((item) => item.status === 'not_found')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const disabledIds = result.items
        .filter((item) => item.status === 'disabled')
        .flatMap((item) => (item.document_id ? [item.document_id] : []))
      const queuedCount = result.items.filter((item) => item.status === 'queued').length
      if (!queuedCount) {
        selection.replace(disabledIds)
        toast.error(
          disabledIds.length
            ? t(($) => $['newKnowledge.documentsReindexFailed'])
            : t(($) => $['newKnowledge.documentsReindexPartial'], {
                missing: missingIds.length,
                queued: 0,
              }),
        )
        invalidateDocumentsAndTasks()
        return
      }
      selection.replace([...missingIds, ...disabledIds])
      if (disabledIds.length) toast.warning(t(($) => $['newKnowledge.documentsReindexFailed']))
      else if (missingIds.length)
        toast.warning(
          t(($) => $['newKnowledge.documentsReindexPartial'], {
            missing: missingIds.length,
            queued: queuedCount,
          }),
        )
      else toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
      invalidateDocumentsAndTasks()
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    canWrite,
    ensureModelReady,
    finishAction,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onWriteDenied,
    reindexDocuments,
    selection,
    selectionDisabled,
    t,
  ])

  const updateAvailability = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !selection.selectedDocumentIds.size ||
      selection.availabilityDisabled ||
      !selection.selectedDocuments.length ||
      !beginAction('availability')
    )
      return
    try {
      const result = await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.patch(
        {
          body: {
            documents: selection.selectedDocuments.map((document) => ({
              documentId: document.id,
              expectedRowVersion: document.rowVersion,
            })),
            enabled: selection.availabilityTargetEnabled,
          },
          params: { control_space_id: knowledgeSpaceId },
        },
      )
      const failedIds = result.items.flatMap((item) =>
        item.status === 'conflict' || item.status === 'not_found' ? [item.document_id] : [],
      )
      selection.replace(failedIds)
      if (failedIds.length) toast.warning(t(($) => $['newKnowledge.documentsErrorDescription']))
      invalidateDocuments()
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    canWrite,
    finishAction,
    invalidateDocuments,
    knowledgeSpaceId,
    onWriteDenied,
    selection,
    selectionDisabled,
    t,
  ])

  const download = useCallback(async () => {
    if (
      !canWrite ||
      !canDownload ||
      !selection.downloadableDocumentIds.length ||
      !beginAction('download')
    )
      return
    try {
      const file =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.downloadZip.post({
          body: { document_ids: selection.downloadableDocumentIds },
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
      toast.error(tCommon(($) => $['actionMsg.downloadUnsuccessfully']))
    } finally {
      finishAction()
    }
  }, [beginAction, canDownload, canWrite, finishAction, knowledgeSpaceId, selection, tCommon])

  const remove = useCallback(async () => {
    if (
      !canWrite ||
      selectionDisabled ||
      !selection.selectedDocumentIds.size ||
      !selection.selectedDocuments.length ||
      !beginAction('remove')
    )
      return false
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.bulk.delete({
        body: {
          documents: selection.selectedDocuments.map((document) => ({
            documentId: document.id,
            expectedRevision: document.rowVersion,
          })),
        },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId },
      })
      selection.clear()
      invalidateDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
      return false
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    canWrite,
    finishAction,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onWriteDenied,
    selection,
    selectionDisabled,
    t,
  ])

  return { download, pendingAction, reindex, remove, updateAvailability }
}
