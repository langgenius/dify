import type { SimpleDocumentDetail } from '@/models/datasets'
import { useCallback, useMemo, useState } from 'react'
import { DataSourceType } from '@/models/datasets'

type LocalDoc = SimpleDocumentDetail & { percent?: number }

type UseDocumentSelectionOptions = {
  documents: LocalDoc[]
  selectedIds: string[]
  onSelectedIdChange: (selectedIds: string[]) => void
}

// Snapshot just the bits of a selected document we need for batch-action
// gating, so the gating stays correct across pagination. The current page's
// `documents` array only contains rows visible right now, so a selection
// made on a previous page would otherwise be invisible to
// `downloadableSelectedIds` and `hasErrorDocumentsSelected` once the user
// navigates away.
type SelectedDocMeta = {
  isFile: boolean
  isError: boolean
}

export const useDocumentSelection = ({
  documents,
  selectedIds,
  onSelectedIdChange,
}: UseDocumentSelectionOptions) => {
  const [selectedDocMeta, setSelectedDocMeta] = useState<Map<string, SelectedDocMeta>>(
    () => new Map(),
  )

  // Single write-path for selection mutations driven by the visible page.
  // Looks up metadata for each newly-selected id from the current page's docs
  // and drops metadata for ids that left the selection.
  const updateSelectionFromCurrentPage = useCallback(
    (nextSelectedIds: string[]) => {
      setSelectedDocMeta((prev) => {
        const next = new Map(prev)
        const nextSet = new Set(nextSelectedIds)
        for (const id of Array.from(prev.keys())) {
          if (!nextSet.has(id))
            next.delete(id)
        }
        for (const doc of documents) {
          if (!nextSet.has(doc.id))
            continue
          const isFile = doc.data_source_type === DataSourceType.FILE
          const isError = doc.display_status === 'error'
          const existing = next.get(doc.id)
          if (!existing || existing.isFile !== isFile || existing.isError !== isError)
            next.set(doc.id, { isFile, isError })
        }
        return next
      })
      onSelectedIdChange(nextSelectedIds)
    },
    [documents, onSelectedIdChange],
  )

  const clearSelection = useCallback(() => {
    setSelectedDocMeta(new Map())
    onSelectedIdChange([])
  }, [onSelectedIdChange])

  // `selectedDocMeta` is the source of truth for whether a selected id is a
  // FILE / in `error` status. `selectedIds` is the source of truth for the
  // active selection. If a doc was selected on a previous page we will not
  // have recorded its metadata; that id is just absent from the map and
  // contributes neither to `downloadableSelectedIds` nor to
  // `hasErrorDocumentsSelected` — better than the previous behaviour, which
  // forgot the metadata of every off-page selection.
  const hasErrorDocumentsSelected = useMemo(() => {
    for (const id of selectedIds) {
      if (selectedDocMeta.get(id)?.isError)
        return true
    }
    return false
  }, [selectedIds, selectedDocMeta])

  const downloadableSelectedIds = useMemo(
    () => selectedIds.filter(id => selectedDocMeta.get(id)?.isFile),
    [selectedIds, selectedDocMeta],
  )

  return {
    hasErrorDocumentsSelected,
    downloadableSelectedIds,
    clearSelection,
    updateSelectionFromCurrentPage,
  }
}
