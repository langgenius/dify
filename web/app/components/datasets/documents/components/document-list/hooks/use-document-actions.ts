import type { CommonResponse } from '@/models/common'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { DocumentActionType } from '@/models/datasets'
import {
  useDocumentArchive,
  useDocumentBatchRetryIndex,
  useDocumentDelete,
  useDocumentDisable,
  useDocumentDownloadZip,
  useDocumentEnable,
  useDocumentSummary,
} from '@/service/knowledge/use-document'
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
  const randomPart = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
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
  const { t } = useTranslation()

  const { mutateAsync: archiveDocument } = useDocumentArchive()
  const { mutateAsync: generateSummary } = useDocumentSummary()
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()
  const { mutateAsync: retryIndexDocument } = useDocumentBatchRetryIndex()
  const { mutateAsync: requestDocumentsZip, isPending: isDownloadingZip } = useDocumentDownloadZip()

  type SupportedActionType
    = | typeof DocumentActionType.archive
      | typeof DocumentActionType.summary
      | typeof DocumentActionType.enable
      | typeof DocumentActionType.disable
      | typeof DocumentActionType.delete

  const actionMutationMap = useMemo(() => ({
    [DocumentActionType.archive]: archiveDocument,
    [DocumentActionType.summary]: generateSummary,
    [DocumentActionType.enable]: enableDocument,
    [DocumentActionType.disable]: disableDocument,
    [DocumentActionType.delete]: deleteDocument,
  } as const), [archiveDocument, generateSummary, enableDocument, disableDocument, deleteDocument])

  const handleAction = useCallback((actionName: SupportedActionType) => {
    return async () => {
      const opApi = actionMutationMap[actionName]
      if (!opApi)
        return

      const [e] = await asyncRunSafe<CommonResponse>(
        opApi({ datasetId, documentIds: selectedIds }),
      )

      if (!e) {
        if (actionName === DocumentActionType.delete)
          onClearSelection()
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
        onUpdate()
      }
      else {
        toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      }
    }
  }, [actionMutationMap, datasetId, selectedIds, onClearSelection, onUpdate, t])

  const handleBatchReIndex = useCallback(async () => {
    const [e] = await asyncRunSafe<CommonResponse>(
      retryIndexDocument({ datasetId, documentIds: selectedIds }),
    )
    if (!e) {
      onClearSelection()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      onUpdate()
    }
    else {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
  }, [retryIndexDocument, datasetId, selectedIds, onClearSelection, onUpdate, t])

  const handleBatchDownload = useCallback(async () => {
    if (isDownloadingZip)
      return

    const [e, blob] = await asyncRunSafe(
      requestDocumentsZip({ datasetId, documentIds: downloadableSelectedIds }),
    )
    if (e || !blob) {
      toast.error(t('actionMsg.downloadUnsuccessfully', { ns: 'common' }))
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
