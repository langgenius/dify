import type { EnsureKnowledgeModelReady } from '../../use-knowledge-model-setup-guard'
import type { DocumentProcessingTask } from '../models'
import type {
  PermissionRecoveryEvent,
  PermissionRecoveryRuntimeState,
} from '../permission-recovery/runtime-state'
import { atom } from 'jotai'
import {
  createPermissionRecoveryRuntimeState,
  transitionPermissionRecoveryRuntimeState,
} from '../permission-recovery/runtime-state'
import { documentsDownloadPermissionAtom, documentsSpaceContextAtom } from './inputs'
import {
  documentPermissionDeniedAtom,
  sourcePermissionDeniedAtom,
  taskPermissionDeniedAtom,
} from './queries'

type DocumentTaskRuntimeBridge = {
  acceptTaskSnapshot: (task: DocumentProcessingTask) => void
  auxiliaryReadPermissionDenied: boolean
  resetFailedPollBlocks: () => void
  retryAuxiliaryTaskRead: () => void
}

const unavailableAction = () => {
  throw new Error('Documents runtime action is not ready')
}

export const documentTaskRuntimeBridgeAtom = atom<DocumentTaskRuntimeBridge>({
  acceptTaskSnapshot: unavailableAction,
  auxiliaryReadPermissionDenied: false,
  resetFailedPollBlocks: unavailableAction,
  retryAuxiliaryTaskRead: unavailableAction,
})

export const documentModelReadyActionAtom = atom<{ ensureModelReady: EnsureKnowledgeModelReady }>({
  ensureModelReady: async () => unavailableAction(),
})

export const documentAuxiliaryReadPermissionDeniedAtom = atom(
  (get) => get(documentTaskRuntimeBridgeAtom).auxiliaryReadPermissionDenied,
)

export const documentHasWorkspaceWritePermissionAtom = atom((get) =>
  get(documentsSpaceContextAtom).space.permission_keys.includes('knowledge_space_document_write'),
)
export const documentReadDenialsAtom = atom((get) => ({
  documents: get(documentPermissionDeniedAtom) || get(documentAuxiliaryReadPermissionDeniedAtom),
  sources: get(sourcePermissionDeniedAtom),
  tasks: get(taskPermissionDeniedAtom),
}))
export const documentPermissionRecoveryStateOverrideAtom = atom<
  PermissionRecoveryRuntimeState | undefined
>()
const documentPermissionRecoveryStateAtom = atom(
  (get) =>
    get(documentPermissionRecoveryStateOverrideAtom) ??
    createPermissionRecoveryRuntimeState({
      denials: get(documentReadDenialsAtom),
      writable: get(documentHasWorkspaceWritePermissionAtom),
    }),
)
export const applyDocumentPermissionRecoveryEventAtom = atom(
  null,
  (get, set, event: PermissionRecoveryEvent) => {
    const current = get(documentPermissionRecoveryStateAtom)
    const transition = transitionPermissionRecoveryRuntimeState(current, event)
    if (!get(documentPermissionRecoveryStateOverrideAtom) || transition.state !== current)
      set(documentPermissionRecoveryStateOverrideAtom, transition.state)
    return transition
  },
)

export const documentCanReadAtom = atom((get) => {
  const denials = get(documentReadDenialsAtom)
  return !denials.documents && !denials.sources && !denials.tasks
})
export const documentWritePermissionStatusAtom = atom(
  (get) => get(documentPermissionRecoveryStateAtom).write.status,
)
export const documentCanWriteAtom = atom(
  (get) =>
    get(documentCanReadAtom) &&
    get(documentHasWorkspaceWritePermissionAtom) &&
    get(documentWritePermissionStatusAtom) === 'writable',
)
export const documentCanDownloadAtom = atom((get) => get(documentsDownloadPermissionAtom))
export const documentPermissionDenialIdentityAtom = atom(
  (get) =>
    `${get(documentPermissionDeniedAtom) ? 'documents' : ''}:${get(documentAuxiliaryReadPermissionDeniedAtom) ? 'auxiliary' : ''}:${get(taskPermissionDeniedAtom) ? 'tasks' : ''}:${get(sourcePermissionDeniedAtom) ? 'sources' : ''}`,
)
export const documentCanRetryReadAtom = atom(
  (get) => get(documentAuxiliaryReadPermissionDeniedAtom) && !get(documentPermissionDeniedAtom),
)

export const denyDocumentWriteAtom = atom(null, async (get, set) => {
  const denial = set(applyDocumentPermissionRecoveryEventAtom, { type: 'write-denied' })
  const generation = denial.state.write.generation
  set(applyDocumentPermissionRecoveryEventAtom, { type: 'write-refresh-started', generation })
  try {
    const space = await get(documentsSpaceContextAtom).refetch()
    set(applyDocumentPermissionRecoveryEventAtom, {
      type: 'write-refresh-finished',
      generation,
      writable: Boolean(space?.permission_keys.includes('knowledge_space_document_write')),
    })
  } catch {
    set(applyDocumentPermissionRecoveryEventAtom, {
      type: 'write-refresh-finished',
      generation,
      writable: false,
    })
  }
})

export const acceptDocumentTaskSnapshotAtom = atom(
  null,
  (get, _set, task: DocumentProcessingTask) => {
    get(documentTaskRuntimeBridgeAtom).acceptTaskSnapshot(task)
  },
)

export const resetDocumentFailedTaskPollBlocksAtom = atom(null, (get) => {
  get(documentTaskRuntimeBridgeAtom).resetFailedPollBlocks()
})

export const retryDocumentAuxiliaryTaskReadAtom = atom(null, (get) => {
  get(documentTaskRuntimeBridgeAtom).retryAuxiliaryTaskRead()
})

export const ensureDocumentModelReadyAtom = atom(
  null,
  (get, _set, request: Parameters<EnsureKnowledgeModelReady>[0]) =>
    get(documentModelReadyActionAtom).ensureModelReady(request),
)

export const retryDocumentReadAtom = atom(null, (_get, set) => {
  set(applyDocumentPermissionRecoveryEventAtom, { type: 'read-retry-requested' })
  set(retryDocumentAuxiliaryTaskReadAtom)
})
