import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'

export type DocumentRowAction =
  | 'download'
  | 'reindex'
  | 'remove'
  | 'rename'
  | 'retry'
  | 'toggle-availability'

export const documentRowPendingActionsAtom = atom(new Map<string, DocumentRowAction>())

export const createDocumentRowPendingActionAtom = (documentId: string) =>
  selectAtom(documentRowPendingActionsAtom, (pending) => pending.get(documentId))

export const beginDocumentRowActionAtom = atom(
  null,
  (get, set, { action, documentId }: { action: DocumentRowAction; documentId: string }) => {
    const pending = get(documentRowPendingActionsAtom)
    if (pending.has(documentId)) return false
    set(documentRowPendingActionsAtom, new Map(pending).set(documentId, action))
    return true
  },
)

export const finishDocumentRowActionAtom = atom(
  null,
  (get, set, { action, documentId }: { action: DocumentRowAction; documentId: string }) => {
    const pending = get(documentRowPendingActionsAtom)
    if (pending.get(documentId) !== action) return
    const next = new Map(pending)
    next.delete(documentId)
    set(documentRowPendingActionsAtom, next)
  },
)
