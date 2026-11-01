import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { StateCreator } from 'zustand'
import type {
  Edge,
  Node,
  TriggerNodeType,
  WorkflowRunningData,
} from '@/app/components/workflow/types'

type PreviewRunningData = WorkflowRunningData & {
  resultTabActive?: boolean
  resultText?: string
  resultTextSelectorKey?: string
  // separated-mode reasoning deltas per LLM node id (live preview only)
  reasoningContent?: Record<string, string>
  // true once the terminal reasoning marker arrived
  reasoningFinished?: boolean
  // human input form schema or data cached when node is in 'Paused' status
  extraContentAndFormData?: Record<string, unknown>
}

type MousePosition = {
  pageX: number
  pageY: number
  elementX: number
  elementY: number
}

export type WorkflowSliceShape = {
  singleNodeRunGenerations: Record<string, number | undefined>
  singleNodeRunErrorGenerations: Record<string, number | undefined>
  singleNodeRunErrors: Record<string, string | undefined>
  workflowNodeExecutions: Record<string, { id: string; errorGeneration: number } | undefined>
  trackWorkflowNodeExecution: (nodeId: string, executionId: string, workflowRunId: string) => void
  clearSingleNodeRunErrorForExecution: (
    nodeId: string,
    executionId: string,
    workflowRunId: string,
  ) => void
  advanceSingleNodeRunGeneration: (nodeId: string) => number
  setSingleNodeRunError: (nodeId: string, message: string) => void
  workflowRunningData?: PreviewRunningData
  setWorkflowRunningData: (workflowData: PreviewRunningData) => void
  isListening: boolean
  setIsListening: (listening: boolean) => void
  canvasReadOnly: boolean
  setCanvasReadOnly: (readOnly: boolean) => void
  listeningTriggerType: TriggerNodeType | null
  setListeningTriggerType: (triggerType: TriggerNodeType | null) => void
  listeningTriggerNodeId: string | null
  setListeningTriggerNodeId: (nodeId: string | null) => void
  listeningTriggerNodeIds: string[]
  setListeningTriggerNodeIds: (nodeIds: string[]) => void
  listeningTriggerIsAll: boolean
  setListeningTriggerIsAll: (isAll: boolean) => void
  clipboardElements: Node[]
  clipboardEdges: Edge[]
  setClipboardElements: (clipboardElements: Node[]) => void
  setClipboardEdges: (clipboardEdges: Edge[]) => void
  setClipboardData: (clipboardData: { nodes: Node[]; edges: Edge[] }) => void
  selection: null | { x1: number; y1: number; x2: number; y2: number }
  setSelection: (selection: WorkflowSliceShape['selection']) => void
  bundleNodeSize: { width: number; height: number } | null
  setBundleNodeSize: (bundleNodeSize: WorkflowSliceShape['bundleNodeSize']) => void
  controlMode: 'pointer' | 'hand' | 'comment'
  setControlMode: (controlMode: WorkflowSliceShape['controlMode']) => void
  pendingComment: MousePosition | null
  setPendingComment: (pendingComment: WorkflowSliceShape['pendingComment']) => void
  isCommentPlacing: boolean
  setCommentPlacing: (isCommentPlacing: boolean) => void
  isCommentQuickAdd: boolean
  setCommentQuickAdd: (isCommentQuickAdd: boolean) => void
  isCommentPreviewHovering: boolean
  setCommentPreviewHovering: (hovering: boolean) => void
  mousePosition: { pageX: number; pageY: number; elementX: number; elementY: number }
  setMousePosition: (mousePosition: WorkflowSliceShape['mousePosition']) => void
  showConfirm?: { title: string; desc?: string; onConfirm: () => void; onCancel?: () => void }
  setShowConfirm: (showConfirm: WorkflowSliceShape['showConfirm']) => void
  controlPromptEditorRerenderKey: number
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey: number) => void
  showImportDSLModal: boolean
  setShowImportDSLModal: (showImportDSLModal: boolean) => void
  fileUploadConfig?: UploadConfig
  setFileUploadConfig: (fileUploadConfig: UploadConfig) => void
}

export const createWorkflowSlice: StateCreator<WorkflowSliceShape> = (set, get) => ({
  singleNodeRunGenerations: {},
  singleNodeRunErrorGenerations: {},
  singleNodeRunErrors: {},
  workflowNodeExecutions: {},
  trackWorkflowNodeExecution: (nodeId, executionId, workflowRunId) => {
    const key = JSON.stringify([workflowRunId, nodeId])
    if (get().workflowNodeExecutions[key]?.id === executionId) return
    // Taking over feedback must leave an in-flight single request free to settle and clean up.
    const errorGeneration = (get().singleNodeRunErrorGenerations[nodeId] ?? 0) + 1
    set((state) => ({
      singleNodeRunErrorGenerations: {
        ...state.singleNodeRunErrorGenerations,
        [nodeId]: errorGeneration,
      },
      singleNodeRunErrors: { ...state.singleNodeRunErrors, [nodeId]: undefined },
      workflowNodeExecutions: {
        ...state.workflowNodeExecutions,
        [key]: { id: executionId, errorGeneration },
      },
    }))
  },
  clearSingleNodeRunErrorForExecution: (nodeId, executionId, workflowRunId) => {
    const key = JSON.stringify([workflowRunId, nodeId])
    const execution = get().workflowNodeExecutions[key]
    if (!execution) {
      get().trackWorkflowNodeExecution(nodeId, executionId, workflowRunId)
      return
    }
    if (
      execution.id !== executionId ||
      execution.errorGeneration !== get().singleNodeRunErrorGenerations[nodeId]
    )
      return
    set((state) => ({ singleNodeRunErrors: { ...state.singleNodeRunErrors, [nodeId]: undefined } }))
  },
  advanceSingleNodeRunGeneration: (nodeId) => {
    const generation = (get().singleNodeRunGenerations[nodeId] ?? 0) + 1
    set((state) => ({
      singleNodeRunGenerations: { ...state.singleNodeRunGenerations, [nodeId]: generation },
      singleNodeRunErrorGenerations: {
        ...state.singleNodeRunErrorGenerations,
        [nodeId]: (state.singleNodeRunErrorGenerations[nodeId] ?? 0) + 1,
      },
      singleNodeRunErrors: { ...state.singleNodeRunErrors, [nodeId]: undefined },
    }))
    return generation
  },
  setSingleNodeRunError: (nodeId, message) =>
    set((state) => ({
      singleNodeRunErrors: { ...state.singleNodeRunErrors, [nodeId]: message },
    })),
  workflowRunningData: undefined,
  setWorkflowRunningData: (workflowRunningData) => set(() => ({ workflowRunningData })),
  isListening: false,
  setIsListening: (listening) => set(() => ({ isListening: listening })),
  canvasReadOnly: false,
  setCanvasReadOnly: (canvasReadOnly) => set(() => ({ canvasReadOnly })),
  listeningTriggerType: null,
  setListeningTriggerType: (triggerType) => set(() => ({ listeningTriggerType: triggerType })),
  listeningTriggerNodeId: null,
  setListeningTriggerNodeId: (nodeId) => set(() => ({ listeningTriggerNodeId: nodeId })),
  listeningTriggerNodeIds: [],
  setListeningTriggerNodeIds: (nodeIds) => set(() => ({ listeningTriggerNodeIds: nodeIds })),
  listeningTriggerIsAll: false,
  setListeningTriggerIsAll: (isAll) => set(() => ({ listeningTriggerIsAll: isAll })),
  clipboardElements: [],
  clipboardEdges: [],
  setClipboardElements: (clipboardElements) => set(() => ({ clipboardElements })),
  setClipboardEdges: (clipboardEdges) => set(() => ({ clipboardEdges })),
  setClipboardData: ({ nodes, edges }) => {
    set(() => ({
      clipboardElements: nodes,
      clipboardEdges: edges,
    }))
  },
  selection: null,
  setSelection: (selection) => set(() => ({ selection })),
  bundleNodeSize: null,
  setBundleNodeSize: (bundleNodeSize) => set(() => ({ bundleNodeSize })),
  controlMode: 'pointer',
  setControlMode: (controlMode) => set(() => ({ controlMode })),
  pendingComment: null,
  setPendingComment: (pendingComment) => set(() => ({ pendingComment })),
  isCommentPlacing: false,
  setCommentPlacing: (isCommentPlacing) => set(() => ({ isCommentPlacing })),
  isCommentQuickAdd: false,
  setCommentQuickAdd: (isCommentQuickAdd) => set(() => ({ isCommentQuickAdd })),
  mousePosition: { pageX: 0, pageY: 0, elementX: 0, elementY: 0 },
  setMousePosition: (mousePosition) => set(() => ({ mousePosition })),
  isCommentPreviewHovering: false,
  setCommentPreviewHovering: (hovering) => set(() => ({ isCommentPreviewHovering: hovering })),
  showConfirm: undefined,
  setShowConfirm: (showConfirm) => set(() => ({ showConfirm })),
  controlPromptEditorRerenderKey: 0,
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey) =>
    set(() => ({ controlPromptEditorRerenderKey })),
  showImportDSLModal: false,
  setShowImportDSLModal: (showImportDSLModal) => set(() => ({ showImportDSLModal })),
  fileUploadConfig: undefined,
  setFileUploadConfig: (fileUploadConfig) => set(() => ({ fileUploadConfig })),
})
