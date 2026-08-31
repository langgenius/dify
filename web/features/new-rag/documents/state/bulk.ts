import { atom } from 'jotai'

export type DocumentBulkAction = 'availability' | 'download' | 'reindex' | 'remove'

export const documentBulkPendingActionAtom = atom<DocumentBulkAction | undefined>()

export const beginDocumentBulkActionAtom = atom(null, (get, set, action: DocumentBulkAction) => {
  if (get(documentBulkPendingActionAtom)) return false
  set(documentBulkPendingActionAtom, action)
  return true
})

export const finishDocumentBulkActionAtom = atom(null, (get, set, action: DocumentBulkAction) => {
  if (get(documentBulkPendingActionAtom) === action) set(documentBulkPendingActionAtom, undefined)
})
