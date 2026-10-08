import type { Viewport } from 'reactflow'
import type { StateCreator } from 'zustand'
import type { Edge, EnvironmentVariable, Node } from '@/app/components/workflow/types'
import { debounce } from 'es-toolkit/compat'
import { v4 as uuid4 } from 'uuid'

type DebouncedFunc = {
  (fn: () => void): void
  cancel?: () => void
  flush?: () => void
}

export type WorkflowDraftSliceShape = {
  workflowInstanceId: string
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    features?: Record<string, any>
    environmentVariables: EnvironmentVariable[]
  }
  setBackupDraft: (backupDraft?: WorkflowDraftSliceShape['backupDraft']) => void
  debouncedSyncWorkflowDraft: DebouncedFunc
  syncWorkflowDraftHash: string
  setSyncWorkflowDraftHash: (hash: string) => void
  isSyncingWorkflowDraft: boolean
  setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft: boolean) => void
  isWorkflowDataLoaded: boolean
  setIsWorkflowDataLoaded: (loaded: boolean) => void
  nodes: Node[]
  setNodes: (nodes: Node[]) => void
  flushPendingSync: () => void
}

export const createWorkflowDraftSlice: StateCreator<WorkflowDraftSliceShape> = (set) => {
  // Create the debounced function and store it with access to cancel/flush methods
  const debouncedFn = debounce((syncWorkflowDraft) => {
    syncWorkflowDraft()
  }, 5000)

  return {
    workflowInstanceId: uuid4(),
    backupDraft: undefined,
    setBackupDraft: (backupDraft) => set(() => ({ backupDraft })),
    debouncedSyncWorkflowDraft: debouncedFn,
    syncWorkflowDraftHash: '',
    setSyncWorkflowDraftHash: (syncWorkflowDraftHash) => set(() => ({ syncWorkflowDraftHash })),
    isSyncingWorkflowDraft: false,
    setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft) => set(() => ({ isSyncingWorkflowDraft })),
    isWorkflowDataLoaded: false,
    setIsWorkflowDataLoaded: (loaded) => set(() => ({ isWorkflowDataLoaded: loaded })),
    nodes: [],
    setNodes: (nodes) => set(() => ({ nodes })),
    flushPendingSync: () => {
      // Flush any pending debounced sync operations
      if (debouncedFn.flush) debouncedFn.flush()
    },
  }
}
