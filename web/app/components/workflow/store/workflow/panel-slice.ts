import type { StateCreator } from 'zustand'

export type WorkflowContextMenuTarget =
  | { type: 'panel' }
  | { type: 'selection' }
  | { type: 'node'; nodeId: string }
  | { type: 'edge'; edgeId: string }

/** A node pinned as explicit context for the Workflow Copilot conversation. */
export type CopilotContextNode = {
  id: string
  title: string
}

export type PanelSliceShape = {
  panelWidth: number
  setPanelWidth: (width: number) => void
  showFeaturesPanel: boolean
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  showWorkflowVersionHistoryPanel: boolean
  setShowWorkflowVersionHistoryPanel: (showWorkflowVersionHistoryPanel: boolean) => void
  showInputsPanel: boolean
  setShowInputsPanel: (showInputsPanel: boolean) => void
  showDebugAndPreviewPanel: boolean
  setShowDebugAndPreviewPanel: (showDebugAndPreviewPanel: boolean) => void
  showCopilotPanel: boolean
  setShowCopilotPanel: (showCopilotPanel: boolean) => void
  // Nodes pinned as explicit context for the Copilot conversation. Populated
  // from a node's "..." menu ("Add to Copilot"); the copilot panel reads and
  // renders these as removable chips.
  copilotContextNodes: CopilotContextNode[]
  addCopilotContextNode: (node: CopilotContextNode) => void
  removeCopilotContextNode: (id: string) => void
  clearCopilotContextNodes: () => void
  showCommentsPanel: boolean
  setShowCommentsPanel: (showCommentsPanel: boolean) => void
  showUserComments: boolean
  setShowUserComments: (showUserComments: boolean) => void
  showUserCursors: boolean
  setShowUserCursors: (showUserCursors: boolean) => void
  contextMenuTarget?: WorkflowContextMenuTarget
  setContextMenuTarget: (contextMenuTarget: WorkflowContextMenuTarget | undefined) => void
  showVariableInspectPanel: boolean
  setShowVariableInspectPanel: (showVariableInspectPanel: boolean) => void
  initShowLastRunTab: boolean
  setInitShowLastRunTab: (initShowLastRunTab: boolean) => void
  activeCommentId?: string | null
  setActiveCommentId: (commentId: string | null) => void
}

export const createPanelSlice: StateCreator<PanelSliceShape> = (set) => ({
  panelWidth: 420,
  setPanelWidth: (width) =>
    set((state) => (state.panelWidth === width ? state : { panelWidth: width })),
  showFeaturesPanel: false,
  setShowFeaturesPanel: (showFeaturesPanel) => set(() => ({ showFeaturesPanel })),
  showWorkflowVersionHistoryPanel: false,
  setShowWorkflowVersionHistoryPanel: (showWorkflowVersionHistoryPanel) =>
    set(() => ({ showWorkflowVersionHistoryPanel })),
  showInputsPanel: false,
  setShowInputsPanel: (showInputsPanel) => set(() => ({ showInputsPanel })),
  showDebugAndPreviewPanel: false,
  setShowDebugAndPreviewPanel: showDebugAndPreviewPanel => set(() => ({ showDebugAndPreviewPanel })),
  showCopilotPanel: false,
  setShowCopilotPanel: showCopilotPanel => set(() => ({ showCopilotPanel })),
  copilotContextNodes: [],
  addCopilotContextNode: node => set(state =>
    state.copilotContextNodes.some(n => n.id === node.id)
      ? state
      : ({ copilotContextNodes: [...state.copilotContextNodes, node] })),
  removeCopilotContextNode: id => set(state => ({
    copilotContextNodes: state.copilotContextNodes.filter(n => n.id !== id),
  })),
  clearCopilotContextNodes: () => set(() => ({ copilotContextNodes: [] })),
  setShowDebugAndPreviewPanel: (showDebugAndPreviewPanel) =>
    set(() => ({ showDebugAndPreviewPanel })),
  showCommentsPanel: false,
  setShowCommentsPanel: (showCommentsPanel) => set(() => ({ showCommentsPanel })),
  showUserComments: true,
  setShowUserComments: (showUserComments) => set(() => ({ showUserComments })),
  showUserCursors: true,
  setShowUserCursors: (showUserCursors) => set(() => ({ showUserCursors })),
  contextMenuTarget: undefined,
  setContextMenuTarget: (contextMenuTarget) => set(() => ({ contextMenuTarget })),
  showVariableInspectPanel: false,
  setShowVariableInspectPanel: (showVariableInspectPanel) =>
    set(() => ({ showVariableInspectPanel })),
  initShowLastRunTab: false,
  setInitShowLastRunTab: (initShowLastRunTab) => set(() => ({ initShowLastRunTab })),
  activeCommentId: null,
  setActiveCommentId: (commentId: string | null) => set(() => ({ activeCommentId: commentId })),
})
