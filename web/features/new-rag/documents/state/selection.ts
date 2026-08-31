import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import {
  documentCanDownload,
  documentCanReindex,
  documentCanToggleAvailability,
  documentShowsAvailabilityAction,
} from '../model'
import { documentsAtom } from './queries'
import {
  documentStatusesAtom,
  filteredDocumentsAtom,
  filteredResultsIncompleteAtom,
  selectionResultsUnavailableAtom,
  taskResultsIncompleteAtom,
} from './results'
import { documentCanWriteAtom } from './runtime'
import { selectedDocumentIdsAtom } from './scoped'
import { documentReadOnlyReasonIdAtom } from './upload'

const MAX_SELECTED_DOCUMENTS = 100

const availableDocumentIdsAtom = atom(
  (get) =>
    new Set(
      get(documentsAtom)
        .filter((document) => document.status !== 'deleting')
        .map((document) => document.id),
    ),
)

export const validSelectedDocumentIdsAtom = atom((get) => {
  const availableDocumentIds = get(availableDocumentIdsAtom)
  return new Set(
    [...get(selectedDocumentIdsAtom)].filter((documentId) => availableDocumentIds.has(documentId)),
  )
})

export const documentBulkActionsVisibleAtom = atom(
  (get) => get(documentCanWriteAtom) && get(validSelectedDocumentIdsAtom).size > 0,
)

export const selectedDocumentsAtom = atom((get) => {
  const selectedDocumentIds = get(validSelectedDocumentIdsAtom)
  return get(documentsAtom).filter((document) => selectedDocumentIds.has(document.id))
})

const selectedStatusesAtom = atom((get) => {
  const statuses = get(documentStatusesAtom)
  return get(selectedDocumentsAtom).map(
    (document) => statuses.get(document.id) ?? ('queued' as const),
  )
})

const selectableFilteredDocumentsAtom = atom((get) =>
  get(filteredDocumentsAtom).filter((document) => document.status !== 'deleting'),
)

export const allFilteredDocumentsSelectedAtom = atom((get) => {
  const selectedDocumentIds = get(validSelectedDocumentIdsAtom)
  const documents = get(selectableFilteredDocumentsAtom)
  return documents.length > 0 && documents.every((document) => selectedDocumentIds.has(document.id))
})

export const someFilteredDocumentsSelectedAtom = atom((get) => {
  const selectedDocumentIds = get(validSelectedDocumentIdsAtom)
  return get(selectableFilteredDocumentsAtom).some((document) =>
    selectedDocumentIds.has(document.id),
  )
})

export const documentSelectionInvalidAtom = atom((get) => {
  const selectedDocuments = get(selectedDocumentsAtom)
  return (
    selectedDocuments.length !== get(validSelectedDocumentIdsAtom).size ||
    selectedDocuments.length > MAX_SELECTED_DOCUMENTS
  )
})

export const selectionAvailabilityTargetEnabledAtom = atom((get) => {
  const selectedDocuments = get(selectedDocumentsAtom)
  return selectedDocuments.length > 0 && selectedDocuments.every((document) => !document.enabled)
})

export const selectionAvailabilityDisabledAtom = atom(
  (get) =>
    get(documentSelectionInvalidAtom) ||
    get(selectedStatusesAtom).some((status) => !documentCanToggleAvailability(status)),
)

export const selectionAvailabilityActionVisibleAtom = atom((get) =>
  get(selectedStatusesAtom).every(documentShowsAvailabilityAction),
)

export const selectionReindexDisabledAtom = atom((get) =>
  get(selectedStatusesAtom).some((status) => !documentCanReindex(status)),
)

export const downloadableDocumentIdsAtom = atom((get) => {
  const selectedDocuments = get(selectedDocumentsAtom)
  const statuses = get(documentStatusesAtom)
  if (
    get(documentSelectionInvalidAtom) ||
    get(taskResultsIncompleteAtom) ||
    selectedDocuments.some((document) => {
      const status = statuses.get(document.id)
      return !status || !documentCanDownload(document, status)
    })
  )
    return []

  return selectedDocuments.map((document) => document.id)
})

export const hasSelectableDocumentsAtom = atom(
  (get) => get(selectableFilteredDocumentsAtom).length > 0,
)

export const documentTableSelectionFactsAtom = atom((get) => {
  const canWrite = get(documentCanWriteAtom)
  const resultsUnavailable = get(selectionResultsUnavailableAtom)
  return {
    allSelected: get(allFilteredDocumentsSelectedAtom),
    canWrite,
    hasSelectableDocuments: get(hasSelectableDocumentsAtom),
    readOnlyReasonId: get(documentReadOnlyReasonIdAtom),
    resultsIncomplete: get(filteredResultsIncompleteAtom),
    selectionDisabled: !canWrite || resultsUnavailable,
    someSelected: get(someFilteredDocumentsSelectedAtom),
  }
})

export const createDocumentRowSelectionFactsAtom = (documentId: string) => {
  const factsAtom = atom((get) => {
    const canWrite = get(documentCanWriteAtom)
    const resultsUnavailable = get(selectionResultsUnavailableAtom)
    return {
      canWrite,
      readOnlyReasonId: get(documentReadOnlyReasonIdAtom),
      resultsIncomplete: get(filteredResultsIncompleteAtom),
      selectionDisabled: !canWrite || resultsUnavailable,
      selected: get(validSelectedDocumentIdsAtom).has(documentId),
    }
  })
  return selectAtom(
    factsAtom,
    (facts) => facts,
    (left, right) =>
      left.canWrite === right.canWrite &&
      left.readOnlyReasonId === right.readOnlyReasonId &&
      left.resultsIncomplete === right.resultsIncomplete &&
      left.selectionDisabled === right.selectionDisabled &&
      left.selected === right.selected,
  )
}

export const clearDocumentSelectionAtom = atom(null, (_get, set) => {
  set(selectedDocumentIdsAtom, new Set())
})

export const replaceDocumentSelectionAtom = atom(null, (_get, set, documentIds: Iterable<string>) =>
  set(selectedDocumentIdsAtom, new Set(documentIds)),
)

export const removeDocumentFromSelectionAtom = atom(null, (get, set, documentId: string) => {
  const next = new Set(get(selectedDocumentIdsAtom))
  next.delete(documentId)
  set(selectedDocumentIdsAtom, next)
})

export const toggleDocumentSelectionAtom = atom(null, (get, set, documentId: string) => {
  const next = new Set(get(selectedDocumentIdsAtom))
  if (next.has(documentId)) next.delete(documentId)
  else next.add(documentId)
  set(selectedDocumentIdsAtom, next)
})

export const toggleAllFilteredDocumentsAtom = atom(null, (get, set) => {
  const next = new Set(get(selectedDocumentIdsAtom))
  const documents = get(selectableFilteredDocumentsAtom)
  if (get(allFilteredDocumentsSelectedAtom))
    documents.forEach((document) => next.delete(document.id))
  else documents.forEach((document) => next.add(document.id))
  set(selectedDocumentIdsAtom, next)
})
