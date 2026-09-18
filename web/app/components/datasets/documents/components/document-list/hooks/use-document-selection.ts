import type { SimpleDocumentDetail } from '@/models/datasets'
import { useCallback, useMemo } from 'react'
import { DataSourceType } from '@/models/datasets'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

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
      .filter((doc) => selectedSet.has(doc.id) && doc.data_source_type === DataSourceType.FILE)
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
