import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'
import { TASK_DRAWER_LIMIT } from '../tasks/drawer-model'
import { createTaskProgressStore } from '../tasks/progress-store'
import { createTaskRuntimeState } from '../tasks/runtime-state'
import { documentBulkPendingActionAtom } from './bulk'
import {
  documentsDownloadPermissionAtom,
  documentsKnowledgeSpaceIdAtom,
  documentsSpaceContextAtom,
} from './inputs'
import { documentRowPendingActionsAtom } from './row-actions'
import {
  documentModelReadyActionAtom,
  documentPermissionRecoveryStateOverrideAtom,
  documentTaskRuntimeBridgeAtom,
} from './runtime'
import { documentUploadingAtom } from './upload'

export const documentTasksOpenAtom = atom(false)
export const documentTaskDrawerVisibleLimitAtom = atom(TASK_DRAWER_LIMIT)
export const documentDependencyRetryRequestAtom = atom({ sources: false })
export const documentPermissionRecoveryFocusRequestAtom = atom<string | undefined>()
export const selectedDocumentIdsAtom = atom<Set<string>>(new Set<string>())
export const taskRuntimeStateAtom = atomWithLazy(createTaskRuntimeState)
export const taskProgressStoreAtom = atomWithLazy(createTaskProgressStore)

export const documentsScopedAtoms = [
  documentsKnowledgeSpaceIdAtom,
  documentsSpaceContextAtom,
  documentsDownloadPermissionAtom,
  documentTasksOpenAtom,
  documentTaskDrawerVisibleLimitAtom,
  documentDependencyRetryRequestAtom,
  documentPermissionRecoveryFocusRequestAtom,
  selectedDocumentIdsAtom,
  taskRuntimeStateAtom,
  taskProgressStoreAtom,
  documentPermissionRecoveryStateOverrideAtom,
  documentTaskRuntimeBridgeAtom,
  documentModelReadyActionAtom,
  documentUploadingAtom,
  documentBulkPendingActionAtom,
  documentRowPendingActionsAtom,
] as const
