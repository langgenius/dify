import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { useCallback, useMemo } from 'react'
import { isDownloadableFileDocument } from '../../../document-source'

type LocalDoc = DocumentWithSegmentsResponse & { percent?: number }

type UseDocumentSelectionOptions = {
  documents: LocalDoc[]
  selectedIds: string[]
  onSelectedIdChange: (selectedIds: string[]) => void
}

export const useDocumentSelection = ({
  documents,
  selectedIds,
  onSelectedIdChange,
}: UseDocumentSelectionOptions) => {
  const hasErrorDocumentsSelected = useMemo(() => {
    return documents.some((doc) => selectedIds.includes(doc.id) && doc.display_status === 'error')
  }, [documents, selectedIds])

  const downloadableSelectedIds = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return documents
      .filter(
        (doc) =>
          selectedSet.has(doc.id) &&
          isDownloadableFileDocument(doc.data_source_type, doc.data_source_info),
      )
      .map((doc) => doc.id)
  }, [documents, selectedIds])

  const clearSelection = useCallback(() => {
    onSelectedIdChange([])
  }, [onSelectedIdChange])

  return {
    hasErrorDocumentsSelected,
    downloadableSelectedIds,
    clearSelection,
  }
}
