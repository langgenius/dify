'use client'

import type { EnsureKnowledgeModelReady } from '../../use-knowledge-model-setup-guard'
import type { DocumentAction } from '../actions-dropdown'
import type { DocumentDisplayStatus } from '../model'
import type { DocumentProcessingTask, LogicalDocument } from '../models'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
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
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'

type UseDocumentRowActionsOptions = {
  canDownload: boolean
  canWrite: boolean
  document: LogicalDocument
  ensureModelReady: EnsureKnowledgeModelReady
  knowledgeSpaceId: string
  onDocumentRemoved: (documentId: string) => void
  onTaskUpdated: (task: DocumentProcessingTask) => void
  onWriteDenied: () => void
  status: DocumentDisplayStatus
  task?: DocumentProcessingTask
  taskResultsIncomplete: boolean
}

export function useDocumentRowActions({
  canDownload,
  canWrite,
  document,
  ensureModelReady,
  knowledgeSpaceId,
  onDocumentRemoved,
  onTaskUpdated,
  onWriteDenied,
  status,
  task,
  taskResultsIncomplete,
}: UseDocumentRowActionsOptions) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const pendingRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<DocumentAction>()
  const { mutateAsync: reindexDocument } = useMutation(
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

  const beginAction = useCallback((action: DocumentAction) => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPendingAction(action)
    return true
  }, [])

  const finishAction = useCallback(() => {
    pendingRef.current = false
    setPendingAction(undefined)
  }, [])

  const rename = useCallback(
    async (title: string) => {
      const normalizedTitle = title.trim()
      if (!canWrite || !normalizedTitle || normalizedTitle === documentTitle(document)) return false
      if (!beginAction('rename')) return false
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
          body: {
            expectedRowVersion: document.rowVersion,
            patch: { displayName: normalizedTitle },
          },
          params: { control_space_id: knowledgeSpaceId, document_id: document.id },
        })
        invalidateDocuments()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) onWriteDenied()
        else toast.error(t(($) => $['newKnowledge.settings.saveFailed']))
        return false
      } finally {
        finishAction()
      }
    },
    [
      beginAction,
      canWrite,
      document,
      finishAction,
      invalidateDocuments,
      knowledgeSpaceId,
      onWriteDenied,
      t,
    ],
  )

  const download = useCallback(async () => {
    if (
      !canDownload ||
      taskResultsIncomplete ||
      !documentCanDownload(document, status) ||
      !beginAction('download')
    )
      return false
    try {
      const file =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.download.get(
          {
            params: { control_space_id: knowledgeSpaceId, document_id: document.id },
          },
        )
      downloadBlob({
        data: file,
        fileName:
          typeof File !== 'undefined' && file instanceof File && file.name
            ? file.name
            : document.title,
      })
      return true
    } catch {
      toast.error(tCommon(($) => $['actionMsg.downloadUnsuccessfully']))
      return false
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    canDownload,
    document,
    finishAction,
    knowledgeSpaceId,
    status,
    taskResultsIncomplete,
    tCommon,
  ])

  const toggleAvailability = useCallback(async () => {
    if (!canWrite || !documentCanToggleAvailability(status) || !beginAction('toggle-availability'))
      return false
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.patch({
        body: {
          enabled: !document.enabled,
          expectedRowVersion: document.rowVersion,
        },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      })
      invalidateDocuments()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else if (responseStatus(error) === 409) {
        invalidateDocuments()
        toast.warning(t(($) => $['newKnowledge.taskActionFailed']))
      } else toast.error(t(($) => $['newKnowledge.documentsErrorDescription']))
      return false
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    canWrite,
    document,
    finishAction,
    invalidateDocuments,
    knowledgeSpaceId,
    onWriteDenied,
    status,
    t,
  ])

  const remove = useCallback(async () => {
    if (!canWrite || !beginAction('remove')) return false
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete({
        body: { expectedRevision: document.rowVersion },
        headers: { 'Idempotency-Key': createRequestId() },
        params: { control_space_id: knowledgeSpaceId, document_id: document.id },
      })
      onDocumentRemoved(document.id)
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
    document.id,
    document.rowVersion,
    finishAction,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onDocumentRemoved,
    onWriteDenied,
    t,
  ])

  const retry = useCallback(async () => {
    if (!canWrite || !task || !taskCanRetry(task) || !beginAction('retry')) return false
    try {
      const updated = backgroundTaskFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post(
          {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: task.id,
              task_kind: task.taskKind,
            },
          },
        ),
      )
      if (updated.documentId && updated.documentRevision)
        onTaskUpdated(updated as DocumentProcessingTask)
      invalidateDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $['newKnowledge.taskActionFailed']))
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
    onTaskUpdated,
    onWriteDenied,
    t,
    task,
  ])

  const reindex = useCallback(async () => {
    if (!canWrite || !documentCanReindex(status) || !beginAction('reindex')) return false
    try {
      if ((await ensureModelReady({ capability: 'index', intent: 'reindex' })).status !== 'ready')
        return false
      const result = await reindexDocument({
        body: { documentIds: [document.id] },
        params: { control_space_id: knowledgeSpaceId },
      })
      const item = result.items[0]
      if (!item || item.status === 'not_found')
        toast.error(
          t(($) => $['newKnowledge.documentsReindexPartial'], {
            missing: 1,
            queued: 0,
          }),
        )
      else if (item.status === 'disabled')
        toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
      else toast.success(t(($) => $['newKnowledge.documentsReindexStarted']))
      invalidateDocumentsAndTasks()
      return true
    } catch (error) {
      if (responseStatus(error) === 403) onWriteDenied()
      else toast.error(t(($) => $['newKnowledge.documentsReindexFailed']))
      return false
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    canWrite,
    document.id,
    ensureModelReady,
    finishAction,
    invalidateDocumentsAndTasks,
    knowledgeSpaceId,
    onWriteDenied,
    reindexDocument,
    status,
    t,
  ])

  return {
    download,
    pendingAction,
    reindex,
    remove,
    rename,
    retry,
    toggleAvailability,
  }
}
