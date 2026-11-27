import type { StateCreator } from 'zustand'

export type LayoutSliceShape = {
  workflowCanvasWidth?: number
  workflowCanvasHeight?: number
  setWorkflowCanvasWidth: (width: number) => void
  setWorkflowCanvasHeight: (height: number) => void
  // rightPanelWidth - otherPanelWidth = nodePanelWidth
  rightPanelWidth?: number
  setRightPanelWidth: (width: number) => void
  nodePanelWidth: number
  setNodePanelWidth: (width: number) => void
  previewPanelWidth: number
  setPreviewPanelWidth: (width: number) => void
  otherPanelWidth: number
  setOtherPanelWidth: (width: number) => void
  variableInspectPanelHeight: number // min-height = 120px; default-height = 320px;
  setVariableInspectPanelHeight: (height: number) => void
}

export const createLayoutSlice: StateCreator<LayoutSliceShape> = (set) => ({
  workflowCanvasWidth: undefined,
  workflowCanvasHeight: undefined,
  setWorkflowCanvasWidth: (width) =>
    set((state) => (state.workflowCanvasWidth === width ? state : { workflowCanvasWidth: width })),
  setWorkflowCanvasHeight: (height) =>
    set((state) =>
      state.workflowCanvasHeight === height ? state : { workflowCanvasHeight: height },
    ),
  rightPanelWidth: undefined,
  setRightPanelWidth: (width) =>
    set((state) => (state.rightPanelWidth === width ? state : { rightPanelWidth: width })),
  nodePanelWidth: 400,
  setNodePanelWidth: (width) =>
    set((state) => (state.nodePanelWidth === width ? state : { nodePanelWidth: width })),
  previewPanelWidth: 400,
  setPreviewPanelWidth: (width) =>
    set((state) => (state.previewPanelWidth === width ? state : { previewPanelWidth: width })),
  otherPanelWidth: 400,
  setOtherPanelWidth: (width) =>
    set((state) => (state.otherPanelWidth === width ? state : { otherPanelWidth: width })),
  variableInspectPanelHeight: 320,
  setVariableInspectPanelHeight: (height) =>
    set((state) =>
      state.variableInspectPanelHeight === height ? state : { variableInspectPanelHeight: height },
    ),
})
