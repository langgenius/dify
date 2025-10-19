import type { StateCreator } from 'zustand'
import { debounce } from 'lodash-es'
import type { Viewport } from 'reactflow'
import type {
  Edge,
  EnvironmentVariable,
  Node,
} from '@/app/components/workflow/types'

export type WorkflowDraftSliceShape = {
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    features?: Record<string, any>
    environmentVariables: EnvironmentVariable[]
  }
  setBackupDraft: (backupDraft?: WorkflowDraftSliceShape['backupDraft']) => void
  debouncedSyncWorkflowDraft: (fn: () => void) => void
  syncWorkflowDraftHash: string
  setSyncWorkflowDraftHash: (hash: string) => void
  isSyncingWorkflowDraft: boolean
  setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft: boolean) => void
}

export const createWorkflowDraftSlice: StateCreator<WorkflowDraftSliceShape> = set => ({
  backupDraft: undefined,
  setBackupDraft: backupDraft => set(() => ({ backupDraft })),
  debouncedSyncWorkflowDraft: debounce((syncWorkflowDraft) => {
    syncWorkflowDraft()
  }, 5000),
  syncWorkflowDraftHash: '',
  setSyncWorkflowDraftHash: syncWorkflowDraftHash => set(() => ({ syncWorkflowDraftHash })),
  isSyncingWorkflowDraft: false,
  setIsSyncingWorkflowDraft: isSyncingWorkflowDraft => set(() => ({ isSyncingWorkflowDraft })),
})
