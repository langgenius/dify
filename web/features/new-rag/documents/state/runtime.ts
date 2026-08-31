import type { EnsureKnowledgeModelReady } from '../../use-knowledge-model-setup-guard'
import type { DocumentProcessingTask } from '../models'
import type { DocumentPermissionRecoveryRuntime } from '../permission-recovery/model'
import { atom } from 'jotai'

type DocumentPermissionRuntime = {
  canDownload: boolean
  canRead: boolean
  canWrite: boolean
  denyWrite: () => void
  initialized: boolean
  recoverySurface: DocumentPermissionRecoveryRuntime
  retryWorkspacePermission: () => Promise<void>
  workspacePermissionRefreshing: boolean
}

type DocumentTaskRuntimeBridge = {
  acceptTaskSnapshot: (task: DocumentProcessingTask) => void
  auxiliaryReadPermissionDenied: boolean
  resetFailedPollBlocks: () => void
  retryAuxiliaryTaskRead: () => void
}

const unavailableAction = () => {
  throw new Error('Documents runtime action is not ready')
}

export const documentPermissionRuntimeAtom = atom<DocumentPermissionRuntime>({
  canDownload: false,
  canRead: false,
  canWrite: false,
  denyWrite: unavailableAction,
  initialized: false,
  recoverySurface: {
    canRetryRead: false,
    denialIdentity: '',
    retryRead: unavailableAction,
    writeStatus: 'readOnly',
  },
  retryWorkspacePermission: async () => unavailableAction(),
  workspacePermissionRefreshing: false,
})

export const documentTaskRuntimeBridgeAtom = atom<DocumentTaskRuntimeBridge>({
  acceptTaskSnapshot: unavailableAction,
  auxiliaryReadPermissionDenied: false,
  resetFailedPollBlocks: unavailableAction,
  retryAuxiliaryTaskRead: unavailableAction,
})

export const documentModelReadyActionAtom = atom<{ ensureModelReady: EnsureKnowledgeModelReady }>({
  ensureModelReady: async () => unavailableAction(),
})

export const documentCanReadAtom = atom((get) => get(documentPermissionRuntimeAtom).canRead)
export const documentCanWriteAtom = atom((get) => get(documentPermissionRuntimeAtom).canWrite)
export const documentCanDownloadAtom = atom((get) => get(documentPermissionRuntimeAtom).canDownload)
export const documentPermissionDenialIdentityAtom = atom(
  (get) => get(documentPermissionRuntimeAtom).recoverySurface.denialIdentity,
)
export const documentCanRetryReadAtom = atom(
  (get) => get(documentPermissionRuntimeAtom).recoverySurface.canRetryRead,
)
export const documentWritePermissionStatusAtom = atom(
  (get) => get(documentPermissionRuntimeAtom).recoverySurface.writeStatus,
)
export const documentPermissionRefreshingAtom = atom(
  (get) => get(documentPermissionRuntimeAtom).workspacePermissionRefreshing,
)
export const documentPermissionInitializedAtom = atom(
  (get) => get(documentPermissionRuntimeAtom).initialized,
)
export const documentAuxiliaryReadPermissionDeniedAtom = atom(
  (get) => get(documentTaskRuntimeBridgeAtom).auxiliaryReadPermissionDenied,
)

export const denyDocumentWriteAtom = atom(null, (get) => {
  get(documentPermissionRuntimeAtom).denyWrite()
})

export const retryDocumentWorkspacePermissionAtom = atom(null, (get) => {
  void get(documentPermissionRuntimeAtom).retryWorkspacePermission()
})

export const retryDocumentReadAtom = atom(null, (get) => {
  get(documentPermissionRuntimeAtom).recoverySurface.retryRead()
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
