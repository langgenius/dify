import type { StateCreator } from 'zustand'
import type { WorkflowSliceShape } from './workflow-slice'
import type { Shape } from '@/app/components/workflow/store'

export type WorkflowAppDraftSliceShape = {
  workflowDraftSyncPhase: 'idle' | 'builder'
  setWorkflowDraftSyncPhase: (phase: WorkflowAppDraftSliceShape['workflowDraftSyncPhase']) => void
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
    autoFollowExecution: !(builderActive && state.builderViewportManuallyChanged),
  }
}

export const createWorkflowAppDraftSlice: StateCreator<
  Shape & WorkflowSliceShape,
  [],
  [],
  WorkflowAppDraftSliceShape
> = (set) => ({
  workflowDraftSyncPhase: 'idle',
  setWorkflowDraftSyncPhase: (workflowDraftSyncPhase) =>
    set((state) => ({
      workflowDraftSyncPhase,
      ...getCanvasState({ ...state, workflowDraftSyncPhase }),
    })),
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
})
