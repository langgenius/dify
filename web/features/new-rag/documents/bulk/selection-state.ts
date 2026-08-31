'use client'

import type { DocumentDisplayStatus } from '../model'
import type { LogicalDocument } from '../models'
import { useCallback, useMemo, useState } from 'react'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentShowsAvailabilityAction,
} from '../model'

const MAX_SELECTED_DOCUMENTS = 100

export function useDocumentBulkSelection({
  canSelect,
  documents,
  filteredDocuments,
  statuses,
  taskResultsIncomplete,
}: {
  canSelect: boolean
  documents: LogicalDocument[]
  filteredDocuments: LogicalDocument[]
  statuses: Map<string, DocumentDisplayStatus>
  taskResultsIncomplete: boolean
}) {
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set())
  const availableDocumentIds = useMemo(
    () =>
      new Set(
        documents
          .filter((document) => document.status !== 'deleting')
          .map((document) => document.id),
      ),
    [documents],
  )
  const validSelectedDocumentIds = useMemo(
    () =>
      new Set(
        [...selectedDocumentIds].filter((documentId) => availableDocumentIds.has(documentId)),
      ),
    [availableDocumentIds, selectedDocumentIds],
  )
  const selectedDocuments = useMemo(
    () => documents.filter((document) => validSelectedDocumentIds.has(document.id)),
    [documents, validSelectedDocumentIds],
  )
  const selectedStatuses = useMemo(
    () => selectedDocuments.map((document) => statuses.get(document.id) ?? ('queued' as const)),
    [selectedDocuments, statuses],
  )
  const selectableFilteredDocuments = useMemo(
    () => filteredDocuments.filter((document) => document.status !== 'deleting'),
    [filteredDocuments],
  )
  const allFilteredSelected =
    selectableFilteredDocuments.length > 0 &&
    selectableFilteredDocuments.every((document) => validSelectedDocumentIds.has(document.id))
  const someFilteredSelected = selectableFilteredDocuments.some((document) =>
    validSelectedDocumentIds.has(document.id),
  )
  const selectionInvalid =
    selectedDocuments.length !== validSelectedDocumentIds.size ||
    selectedDocuments.length > MAX_SELECTED_DOCUMENTS
  const availabilityTargetEnabled =
    selectedDocuments.length > 0 && selectedDocuments.every((document) => !document.enabled)
  const availabilityDisabled =
    selectionInvalid || selectedStatuses.some((status) => !documentCanToggleAvailability(status))
  const availabilityActionVisible = selectedStatuses.every(documentShowsAvailabilityAction)
  const reindexDisabled = selectedStatuses.some((status) => !documentCanReindex(status))
  const downloadableDocumentIds = useMemo(() => {
    if (
      selectionInvalid ||
      taskResultsIncomplete ||
      selectedDocuments.some((document) => {
        const status = statuses.get(document.id)
        return !status || !documentCanDownload(document, status)
      })
    )
      return []
    return selectedDocuments.map((document) => document.id)
  }, [selectionInvalid, selectedDocuments, statuses, taskResultsIncomplete])

  const clear = useCallback(() => setSelectedDocumentIds(new Set()), [])
  const replace = useCallback(
    (documentIds: Iterable<string>) => setSelectedDocumentIds(new Set(documentIds)),
    [],
  )
  const remove = useCallback((documentId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      next.delete(documentId)
      return next
    })
  }, [])
  const toggle = useCallback(
    (documentId: string) => {
      if (!canSelect) return
      setSelectedDocumentIds((current) => {
        const next = new Set(current)
        if (next.has(documentId)) next.delete(documentId)
        else next.add(documentId)
        return next
      })
    },
    [canSelect],
  )
  const toggleAllFiltered = useCallback(() => {
    if (!canSelect) return
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected)
        selectableFilteredDocuments.forEach((document) => next.delete(document.id))
      else selectableFilteredDocuments.forEach((document) => next.add(document.id))
      return next
    })
  }, [allFilteredSelected, canSelect, selectableFilteredDocuments])

  return {
    allFilteredSelected,
    availabilityActionVisible,
    availabilityDisabled,
    availabilityTargetEnabled,
    clear,
    downloadableDocumentIds,
    hasSelectableDocuments: selectableFilteredDocuments.length > 0,
    reindexDisabled,
    remove,
    replace,
    selectedDocuments,
    selectedDocumentIds: validSelectedDocumentIds,
    selectionInvalid,
    someFilteredSelected,
    toggle,
    toggleAllFiltered,
  }
}

export type DocumentBulkSelection = ReturnType<typeof useDocumentBulkSelection>
