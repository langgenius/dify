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
  bottomPanelWidth: number // min-width = 400px; default-width = auto || 480px;
  setBottomPanelWidth: (width: number) => void
  bottomPanelHeight: number
  setBottomPanelHeight: (height: number) => void
  variableInspectPanelHeight: number // min-height = 120px; default-height = 320px;
  setVariableInspectPanelHeight: (height: number) => void
  maximizeCanvas: boolean
  setMaximizeCanvas: (maximize: boolean) => void
}

export const createLayoutSlice: StateCreator<LayoutSliceShape> = set => ({
  workflowCanvasWidth: undefined,
  workflowCanvasHeight: undefined,
  setWorkflowCanvasWidth: width => set(state =>
    state.workflowCanvasWidth === width ? state : ({ workflowCanvasWidth: width })),
  setWorkflowCanvasHeight: height => set(state =>
    state.workflowCanvasHeight === height ? state : ({ workflowCanvasHeight: height })),
  rightPanelWidth: undefined,
  setRightPanelWidth: width => set(state =>
    state.rightPanelWidth === width ? state : ({ rightPanelWidth: width })),
  nodePanelWidth: localStorage.getItem('workflow-node-panel-width') ? Number.parseFloat(localStorage.getItem('workflow-node-panel-width')!) : 400,
  setNodePanelWidth: width => set(state =>
    state.nodePanelWidth === width ? state : ({ nodePanelWidth: width })),
  previewPanelWidth: localStorage.getItem('debug-and-preview-panel-width') ? Number.parseFloat(localStorage.getItem('debug-and-preview-panel-width')!) : 400,
  setPreviewPanelWidth: width => set(state =>
    state.previewPanelWidth === width ? state : ({ previewPanelWidth: width })),
  otherPanelWidth: 400,
  setOtherPanelWidth: width => set(state =>
    state.otherPanelWidth === width ? state : ({ otherPanelWidth: width })),
  bottomPanelWidth: 480,
  setBottomPanelWidth: width => set(state =>
    state.bottomPanelWidth === width ? state : ({ bottomPanelWidth: width })),
  bottomPanelHeight: 324,
  setBottomPanelHeight: height => set(state =>
    state.bottomPanelHeight === height ? state : ({ bottomPanelHeight: height })),
  variableInspectPanelHeight: localStorage.getItem('workflow-variable-inpsect-panel-height') ? Number.parseFloat(localStorage.getItem('workflow-variable-inpsect-panel-height')!) : 320,
  setVariableInspectPanelHeight: height => set(state =>
    state.variableInspectPanelHeight === height ? state : ({ variableInspectPanelHeight: height })),
  maximizeCanvas: localStorage.getItem('workflow-canvas-maximize') === 'true',
  setMaximizeCanvas: maximize => set(state =>
    state.maximizeCanvas === maximize ? state : ({ maximizeCanvas: maximize })),
})
