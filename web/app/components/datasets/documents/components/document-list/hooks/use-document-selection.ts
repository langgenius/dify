import type { SimpleDocumentDetail } from '@/models/datasets'
import { uniq } from 'es-toolkit/array'
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
  const isAllSelected = useMemo(() => {
    return documents.length > 0 && documents.every(doc => selectedIds.includes(doc.id))
  }, [documents, selectedIds])

  const isSomeSelected = useMemo(() => {
    return documents.some(doc => selectedIds.includes(doc.id))
  }, [documents, selectedIds])

  const onSelectAll = useCallback(() => {
    if (isAllSelected)
      onSelectedIdChange([])
    else
      onSelectedIdChange(uniq([...selectedIds, ...documents.map(doc => doc.id)]))
  }, [isAllSelected, documents, onSelectedIdChange, selectedIds])

  const onSelectOne = useCallback((docId: string) => {
    onSelectedIdChange(
      selectedIds.includes(docId)
        ? selectedIds.filter(id => id !== docId)
        : [...selectedIds, docId],
    )
  }, [selectedIds, onSelectedIdChange])

  const hasErrorDocumentsSelected = useMemo(() => {
    return documents.some(doc => selectedIds.includes(doc.id) && doc.display_status === 'error')
  }, [documents, selectedIds])

  const downloadableSelectedIds = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return documents
      .filter(doc => selectedSet.has(doc.id) && doc.data_source_type === DataSourceType.FILE)
      .map(doc => doc.id)
  }, [documents, selectedIds])

  const clearSelection = useCallback(() => {
    onSelectedIdChange([])
  }, [onSelectedIdChange])

  return {
    isAllSelected,
    isSomeSelected,
    onSelectAll,
    onSelectOne,
    hasErrorDocumentsSelected,
    downloadableSelectedIds,
    clearSelection,
  }
}
