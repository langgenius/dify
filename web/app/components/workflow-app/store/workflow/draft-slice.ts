import type { StateCreator } from 'zustand'
import type { WorkflowSliceShape } from './workflow-slice'
import type { Shape } from '@/app/components/workflow/store'

export type WorkflowAppDraftSliceShape = {
  workflowDraftSyncPhase: 'idle' | 'preparing' | 'builder'
  setWorkflowDraftSyncPhase: (phase: WorkflowAppDraftSliceShape['workflowDraftSyncPhase']) => void
  enqueueWorkflowDraftOperation: <T>(operation: () => Promise<T>) => Promise<T>
  runWorkflowDraftOperationImmediately: <T>(operation: () => Promise<T>) => Promise<T>
  lastSavedWorkflowDraft: { appId: string; generation: number; hash: string } | null
  setLastSavedWorkflowDraft: (saved: WorkflowAppDraftSliceShape['lastSavedWorkflowDraft']) => void
  workflowDraftGeneration: number
  workflowDraftLocalRevision: number
  workflowDraftSavedRevision: number
  markWorkflowDraftDirty: () => number
  markWorkflowDraftSaved: (revision: number) => void
  invalidateWorkflowDraftSync: () => number
  hasWorkflowDraftConflict: boolean
  workflowDraftConflictId: number
  setWorkflowDraftConflict: (conflicted: boolean) => void
  builderCanvasReadOnly: boolean
  builderViewportManuallyChanged: boolean
  setBuilderViewportManuallyChanged: (changed: boolean) => void
  builderEditTargetNodeIds: string[]
  setBuilderEditTargetNodeIds: (nodeIds: string[]) => void
  showDifyBuilderPanel: boolean
  setShowDifyBuilderPanel: (show: boolean) => void
  setCanvasReadOnly: (readOnly: boolean) => void
}

const getCanvasState = (state: WorkflowAppDraftSliceShape) => {
  const builderActive = state.builderCanvasReadOnly || state.workflowDraftSyncPhase !== 'idle'
  return {
    canvasReadOnly: builderActive,
    nodeEditingLocked: state.hasWorkflowDraftConflict,
    autoFollowExecution: !(builderActive && state.builderViewportManuallyChanged),
  }
}

export const createWorkflowAppDraftSlice: StateCreator<
  Shape & WorkflowSliceShape,
  [],
  [],
  WorkflowAppDraftSliceShape
> = (set, get) => {
  let draftQueue: Promise<unknown> = Promise.resolve()
  const immediateOperations = new Set<Promise<unknown>>()

  return {
    workflowDraftSyncPhase: 'idle',
    setWorkflowDraftSyncPhase: (workflowDraftSyncPhase) =>
      set((state) => ({
        workflowDraftSyncPhase,
        ...getCanvasState({ ...state, workflowDraftSyncPhase }),
      })),
    enqueueWorkflowDraftOperation: (operation) => {
      const next = draftQueue
        .catch(() => undefined)
        .then(async () => {
          while (immediateOperations.size > 0) await Promise.allSettled([...immediateOperations])
          return operation()
        })
      draftQueue = next
      return next
    },
    runWorkflowDraftOperationImmediately: (operation) => {
      const next = operation()
      immediateOperations.add(next)
      return next.finally(() => immediateOperations.delete(next))
    },
    lastSavedWorkflowDraft: null,
    setLastSavedWorkflowDraft: (lastSavedWorkflowDraft) => set({ lastSavedWorkflowDraft }),
    workflowDraftGeneration: 0,
    workflowDraftLocalRevision: 0,
    workflowDraftSavedRevision: 0,
    markWorkflowDraftDirty: () => {
      const workflowDraftLocalRevision = get().workflowDraftLocalRevision + 1
      set({ workflowDraftLocalRevision })
      return workflowDraftLocalRevision
    },
    markWorkflowDraftSaved: (revision) =>
      set((state) => ({
        workflowDraftSavedRevision: Math.max(state.workflowDraftSavedRevision, revision),
      })),
    hasWorkflowDraftConflict: false,
    workflowDraftConflictId: 0,
    setWorkflowDraftConflict: (hasWorkflowDraftConflict) => {
      const newConflict = hasWorkflowDraftConflict && !get().hasWorkflowDraftConflict
      if (hasWorkflowDraftConflict) get().invalidateWorkflowDraftSync()
      set((state) => ({
        hasWorkflowDraftConflict,
        workflowDraftConflictId: state.workflowDraftConflictId + (newConflict ? 1 : 0),
        ...getCanvasState({ ...state, hasWorkflowDraftConflict }),
      }))
    },
    invalidateWorkflowDraftSync: () => {
      get().debouncedSyncWorkflowDraft.cancel?.()
      const workflowDraftGeneration = get().workflowDraftGeneration + 1
      set({
        workflowDraftGeneration,
        workflowDraftSavedRevision: get().workflowDraftLocalRevision,
        isSyncingWorkflowDraft: false,
      })
      return workflowDraftGeneration
    },
    builderCanvasReadOnly: false,
    setCanvasReadOnly: (builderCanvasReadOnly) =>
      set((state) => ({
        builderCanvasReadOnly,
        ...getCanvasState({ ...state, builderCanvasReadOnly }),
      })),
    builderViewportManuallyChanged: false,
    setBuilderViewportManuallyChanged: (builderViewportManuallyChanged) =>
      set((state) => ({
        builderViewportManuallyChanged,
        ...getCanvasState({ ...state, builderViewportManuallyChanged }),
      })),
    builderEditTargetNodeIds: [],
    setBuilderEditTargetNodeIds: (builderEditTargetNodeIds) => set({ builderEditTargetNodeIds }),
    showDifyBuilderPanel: false,
    setShowDifyBuilderPanel: (showDifyBuilderPanel) => set({ showDifyBuilderPanel }),
  }
}
