import type { StateCreator } from 'zustand'

export type PanelSliceShape = {
  panelWidth: number
  showFeaturesPanel: boolean
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  showWorkflowVersionHistoryPanel: boolean
  setShowWorkflowVersionHistoryPanel: (showWorkflowVersionHistoryPanel: boolean) => void
  showInputsPanel: boolean
  setShowInputsPanel: (showInputsPanel: boolean) => void
  showDebugAndPreviewPanel: boolean
  setShowDebugAndPreviewPanel: (showDebugAndPreviewPanel: boolean) => void
  panelMenu?: {
    top: number
    left: number
  }
  setPanelMenu: (panelMenu: PanelSliceShape['panelMenu']) => void
  selectionMenu?: {
    top: number
    left: number
  }
  setSelectionMenu: (selectionMenu: PanelSliceShape['selectionMenu']) => void
  showVariableInspectPanel: boolean
  setShowVariableInspectPanel: (showVariableInspectPanel: boolean) => void
  initShowLastRunTab: boolean
  setInitShowLastRunTab: (initShowLastRunTab: boolean) => void
}

export const createPanelSlice: StateCreator<PanelSliceShape> = set => ({
  panelWidth: localStorage.getItem('workflow-node-panel-width') ? Number.parseFloat(localStorage.getItem('workflow-node-panel-width')!) : 420,
  showFeaturesPanel: false,
  setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
  showWorkflowVersionHistoryPanel: false,
  setShowWorkflowVersionHistoryPanel: showWorkflowVersionHistoryPanel => set(() => ({ showWorkflowVersionHistoryPanel })),
  showInputsPanel: false,
  setShowInputsPanel: showInputsPanel => set(() => ({ showInputsPanel })),
  showDebugAndPreviewPanel: false,
  setShowDebugAndPreviewPanel: showDebugAndPreviewPanel => set(() => ({ showDebugAndPreviewPanel })),
  panelMenu: undefined,
  setPanelMenu: panelMenu => set(() => ({ panelMenu })),
  selectionMenu: undefined,
  setSelectionMenu: selectionMenu => set(() => ({ selectionMenu })),
  showVariableInspectPanel: false,
  setShowVariableInspectPanel: showVariableInspectPanel => set(() => ({ showVariableInspectPanel })),
  initShowLastRunTab: false,
  setInitShowLastRunTab: initShowLastRunTab => set(() => ({ initShowLastRunTab })),
})
