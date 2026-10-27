import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { DocumentActionType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { useDocumentDownloadZip } from '@/service/knowledge/use-document'
import { asyncRunSafe } from '@/utils'
import { downloadBlob } from '@/utils/download'

type UseDocumentActionsOptions = {
  datasetId: string
  selectedIds: string[]
  downloadableSelectedIds: string[]
  onUpdate: () => void
  onClearSelection: () => void
}

/**
 * Generate a random ZIP filename for bulk document downloads.
 * We intentionally avoid leaking dataset info in the exported archive name.
 */
const generateDocsZipFileName = (): string => {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${randomPart}-docs.zip`
}

export const useDocumentActions = ({
  datasetId,
  selectedIds,
  downloadableSelectedIds,
  onUpdate,
  onClearSelection,
}: UseDocumentActionsOptions) => {
  const { t } = useTranslation(['common'])

  const documents = consoleQuery.datasets.byDatasetId.documents
  const { mutateAsync: changeDocumentStatus } = useMutation(
    documents.status.byAction.batch.patch.mutationOptions(),
  )
  const { mutateAsync: generateSummary } = useMutation(
    documents.generateSummary.post.mutationOptions(),
  )
  const { mutateAsync: deleteDocuments } = useMutation(documents.delete.mutationOptions())
  const { mutateAsync: retryIndexDocuments } = useMutation(
    consoleQuery.datasets.byDatasetId.retry.post.mutationOptions(),
  )
  const { mutateAsync: requestDocumentsZip, isPending: isDownloadingZip } = useDocumentDownloadZip()

  type SupportedActionType =
    | typeof DocumentActionType.archive
    | typeof DocumentActionType.summary
    | typeof DocumentActionType.enable
    | typeof DocumentActionType.disable
    | typeof DocumentActionType.delete

  const runAction = useCallback(
    (actionName: SupportedActionType): Promise<unknown> => {
      switch (actionName) {
        case DocumentActionType.summary:
          return generateSummary({
            params: { dataset_id: datasetId },
            body: { document_list: selectedIds },
          })
        case DocumentActionType.delete:
          return deleteDocuments({
            params: { dataset_id: datasetId },
            query: { document_id: selectedIds },
          })
        default:
          return changeDocumentStatus({
            params: { dataset_id: datasetId, action: actionName },
            query: { document_id: selectedIds },
          })
      }
    },
    [changeDocumentStatus, datasetId, deleteDocuments, generateSummary, selectedIds],
  )

  const handleAction = useCallback(
    (actionName: SupportedActionType) => {
      return async () => {
        const [e] = await asyncRunSafe(runAction(actionName))

        if (!e) {
          if (actionName === DocumentActionType.delete) onClearSelection()
          toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
          onUpdate()
        } else {
          toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
        }
      }
    },
    [runAction, onClearSelection, onUpdate, t],
  )

  const handleBatchReIndex = useCallback(async () => {
    const [e] = await asyncRunSafe(
      retryIndexDocuments({
        params: { dataset_id: datasetId },
        body: { document_ids: selectedIds },
      }),
    )
    if (!e) {
      onClearSelection()
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      onUpdate()
    } else {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }, [retryIndexDocuments, datasetId, selectedIds, onClearSelection, onUpdate, t])

  const handleBatchDownload = useCallback(async () => {
    if (isDownloadingZip) return

    const [e, blob] = await asyncRunSafe(
      requestDocumentsZip({ datasetId, documentIds: downloadableSelectedIds }),
    )
    if (e || !blob) {
      toast.error(t(($) => $['actionMsg.downloadUnsuccessfully'], { ns: 'common' }))
      return
    }

    downloadBlob({ data: blob, fileName: generateDocsZipFileName() })
  }, [datasetId, downloadableSelectedIds, isDownloadingZip, requestDocumentsZip, t])

  return {
    handleAction,
    handleBatchReIndex,
    handleBatchDownload,
    isDownloadingZip,
  }
}
