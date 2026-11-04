import { atom } from 'jotai'
import { documentsQueryIsFetchingAtom } from '../state/queries'
import {
  documentCanReadAtom,
  documentCanRetryReadAtom,
  documentCanWriteAtom,
  documentPermissionDenialIdentityAtom,
  documentWritePermissionStatusAtom,
} from '../state/runtime'
import { documentPermissionRecoveryFocusRequestAtom, documentTasksOpenAtom } from '../state/scoped'
import { validSelectedDocumentIdsAtom } from '../state/selection'

export const documentPermissionBoundaryFactsAtom = atom((get) => ({
  bulkActionsVisible: get(documentCanWriteAtom) && get(validSelectedDocumentIdsAtom).size > 0,
  canRead: get(documentCanReadAtom),
  denialIdentity: get(documentPermissionDenialIdentityAtom),
  pendingReadRecoveryFocus: get(documentPermissionRecoveryFocusRequestAtom),
  tasksOpen: get(documentTasksOpenAtom),
  writeStatus: get(documentWritePermissionStatusAtom),
}))

export const documentReadRecoveryFactsAtom = atom((get) => ({
  canRetryRead: get(documentCanRetryReadAtom),
  denialIdentity: get(documentPermissionDenialIdentityAtom),
  fetching: get(documentsQueryIsFetchingAtom),
}))
