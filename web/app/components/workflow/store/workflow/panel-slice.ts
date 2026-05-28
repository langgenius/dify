import type { StateCreator } from 'zustand'

export type WorkflowContextMenuTarget
  = | { type: 'panel' }
    | { type: 'selection' }
    | { type: 'node', nodeId: string }
    | { type: 'edge', edgeId: string }

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
  showCommentsPanel: false,
  setShowCommentsPanel: showCommentsPanel => set(() => ({ showCommentsPanel })),
  showUserComments: true,
  setShowUserComments: showUserComments => set(() => ({ showUserComments })),
  showUserCursors: true,
  setShowUserCursors: showUserCursors => set(() => ({ showUserCursors })),
  contextMenuTarget: undefined,
  setContextMenuTarget: contextMenuTarget => set(() => ({ contextMenuTarget })),
  showVariableInspectPanel: false,
  setShowVariableInspectPanel: showVariableInspectPanel => set(() => ({ showVariableInspectPanel })),
  initShowLastRunTab: false,
  setInitShowLastRunTab: initShowLastRunTab => set(() => ({ initShowLastRunTab })),
  activeCommentId: null,
  setActiveCommentId: (commentId: string | null) => set(() => ({ activeCommentId: commentId })),
})
