import type { StateCreator } from 'zustand'
import type { PointerPosition } from '../../utils/pointer-position'
import type {
  Edge,
  Node,
  TriggerNodeType,
  WorkflowRunningData,
} from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import { DEFAULT_POINTER_POSITION } from '../../utils/pointer-position'

type PreviewRunningData = WorkflowRunningData & {
  resultTabActive?: boolean
  resultText?: string
  // human input form schema or data cached when node is in 'Paused' status
  extraContentAndFormData?: Record<string, any>
}

export type WorkflowSliceShape = {
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
  setClipboardData: (clipboardData: { nodes: Node[], edges: Edge[] }) => void
  selection: null | { x1: number, y1: number, x2: number, y2: number }
  setSelection: (selection: WorkflowSliceShape['selection']) => void
  bundleNodeSize: { width: number, height: number } | null
  setBundleNodeSize: (bundleNodeSize: WorkflowSliceShape['bundleNodeSize']) => void
  controlMode: 'pointer' | 'hand' | 'comment'
  setControlMode: (controlMode: WorkflowSliceShape['controlMode']) => void
  pendingComment: PointerPosition | null
  setPendingComment: (pendingComment: WorkflowSliceShape['pendingComment']) => void
  isCommentPlacing: boolean
  setCommentPlacing: (isCommentPlacing: boolean) => void
  isCommentQuickAdd: boolean
  setCommentQuickAdd: (isCommentQuickAdd: boolean) => void
  isCommentPreviewHovering: boolean
  setCommentPreviewHovering: (hovering: boolean) => void
  pointerPositionRef: { current: PointerPosition }
  getPointerPosition: () => PointerPosition
  setPointerPosition: (pointerPosition: PointerPosition) => void
  showConfirm?: { title: string, desc?: string, onConfirm: () => void }
  setShowConfirm: (showConfirm: WorkflowSliceShape['showConfirm']) => void
  controlPromptEditorRerenderKey: number
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey: number) => void
  showImportDSLModal: boolean
  setShowImportDSLModal: (showImportDSLModal: boolean) => void
  fileUploadConfig?: FileUploadConfigResponse
  setFileUploadConfig: (fileUploadConfig: FileUploadConfigResponse) => void
}

export const createWorkflowSlice: StateCreator<WorkflowSliceShape> = (set) => {
  const pointerPositionRef = { current: DEFAULT_POINTER_POSITION }

  return {
    workflowRunningData: undefined,
    setWorkflowRunningData: workflowRunningData => set(() => ({ workflowRunningData })),
    isListening: false,
    setIsListening: listening => set(() => ({ isListening: listening })),
    canvasReadOnly: false,
    setCanvasReadOnly: canvasReadOnly => set(() => ({ canvasReadOnly })),
    listeningTriggerType: null,
    setListeningTriggerType: triggerType => set(() => ({ listeningTriggerType: triggerType })),
    listeningTriggerNodeId: null,
    setListeningTriggerNodeId: nodeId => set(() => ({ listeningTriggerNodeId: nodeId })),
    listeningTriggerNodeIds: [],
    setListeningTriggerNodeIds: nodeIds => set(() => ({ listeningTriggerNodeIds: nodeIds })),
    listeningTriggerIsAll: false,
    setListeningTriggerIsAll: isAll => set(() => ({ listeningTriggerIsAll: isAll })),
    clipboardElements: [],
    clipboardEdges: [],
    setClipboardElements: clipboardElements => set(() => ({ clipboardElements })),
    setClipboardEdges: clipboardEdges => set(() => ({ clipboardEdges })),
    setClipboardData: ({ nodes, edges }) => {
      set(() => ({
        clipboardElements: nodes,
        clipboardEdges: edges,
      }))
    },
    selection: null,
    setSelection: selection => set(() => ({ selection })),
    bundleNodeSize: null,
    setBundleNodeSize: bundleNodeSize => set(() => ({ bundleNodeSize })),
    controlMode: (() => {
      const storedControlMode = localStorage.getItem('workflow-operation-mode')
      if (storedControlMode === 'pointer' || storedControlMode === 'hand' || storedControlMode === 'comment')
        return storedControlMode

      return 'pointer'
    })(),
    setControlMode: (controlMode) => {
      set(() => ({ controlMode }))
      localStorage.setItem('workflow-operation-mode', controlMode)
    },
    pendingComment: null,
    setPendingComment: pendingComment => set(() => ({ pendingComment })),
    isCommentPlacing: false,
    setCommentPlacing: isCommentPlacing => set(() => ({ isCommentPlacing })),
    isCommentQuickAdd: false,
    setCommentQuickAdd: isCommentQuickAdd => set(() => ({ isCommentQuickAdd })),
    pointerPositionRef,
    getPointerPosition: () => pointerPositionRef.current,
    setPointerPosition: (pointerPosition) => {
      pointerPositionRef.current = pointerPosition
    },
    isCommentPreviewHovering: false,
    setCommentPreviewHovering: hovering => set(() => ({ isCommentPreviewHovering: hovering })),
    showConfirm: undefined,
    setShowConfirm: showConfirm => set(() => ({ showConfirm })),
    controlPromptEditorRerenderKey: 0,
    setControlPromptEditorRerenderKey: controlPromptEditorRerenderKey => set(() => ({ controlPromptEditorRerenderKey })),
    showImportDSLModal: false,
    setShowImportDSLModal: showImportDSLModal => set(() => ({ showImportDSLModal })),
    fileUploadConfig: undefined,
    setFileUploadConfig: fileUploadConfig => set(() => ({ fileUploadConfig })),
  }
}
