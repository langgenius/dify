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
  setWorkflowCanvasWidth: width => set(() => ({ workflowCanvasWidth: width })),
  setWorkflowCanvasHeight: height => set(() => ({ workflowCanvasHeight: height })),
  rightPanelWidth: undefined,
  setRightPanelWidth: width => set(() => ({ rightPanelWidth: width })),
  nodePanelWidth: localStorage.getItem('workflow-node-panel-width') ? Number.parseFloat(localStorage.getItem('workflow-node-panel-width')!) : 400,
  setNodePanelWidth: width => set(() => ({ nodePanelWidth: width })),
  previewPanelWidth: localStorage.getItem('debug-and-preview-panel-width') ? Number.parseFloat(localStorage.getItem('debug-and-preview-panel-width')!) : 400,
  setPreviewPanelWidth: width => set(() => ({ previewPanelWidth: width })),
  otherPanelWidth: 400,
  setOtherPanelWidth: width => set(() => ({ otherPanelWidth: width })),
  bottomPanelWidth: 480,
  setBottomPanelWidth: width => set(() => ({ bottomPanelWidth: width })),
  bottomPanelHeight: 324,
  setBottomPanelHeight: height => set(() => ({ bottomPanelHeight: height })),
  variableInspectPanelHeight: localStorage.getItem('workflow-variable-inpsect-panel-height') ? Number.parseFloat(localStorage.getItem('workflow-variable-inpsect-panel-height')!) : 320,
  setVariableInspectPanelHeight: height => set(() => ({ variableInspectPanelHeight: height })),
  maximizeCanvas: localStorage.getItem('workflow-canvas-maximize') === 'true',
  setMaximizeCanvas: maximize => set(() => ({ maximizeCanvas: maximize })),
})
