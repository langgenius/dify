import type { StateCreator } from 'zustand'
import type {
  Node,
  WorkflowRunningData,
} from '@/app/components/workflow/types'

type PreviewRunningData = WorkflowRunningData & {
  resultTabActive?: boolean
  resultText?: string
}

export type WorkflowSliceShape = {
  appId: string
  workflowRunningData?: PreviewRunningData
  setWorkflowRunningData: (workflowData: PreviewRunningData) => void
  notInitialWorkflow: boolean
  setNotInitialWorkflow: (notInitialWorkflow: boolean) => void
  clipboardElements: Node[]
  setClipboardElements: (clipboardElements: Node[]) => void
  selection: null | { x1: number; y1: number; x2: number; y2: number }
  setSelection: (selection: WorkflowSliceShape['selection']) => void
  bundleNodeSize: { width: number; height: number } | null
  setBundleNodeSize: (bundleNodeSize: WorkflowSliceShape['bundleNodeSize']) => void
  controlMode: 'pointer' | 'hand'
  setControlMode: (controlMode: WorkflowSliceShape['controlMode']) => void
  mousePosition: { pageX: number; pageY: number; elementX: number; elementY: number }
  setMousePosition: (mousePosition: WorkflowSliceShape['mousePosition']) => void
  showConfirm?: { title: string; desc?: string; onConfirm: () => void }
  setShowConfirm: (showConfirm: WorkflowSliceShape['showConfirm']) => void
  controlPromptEditorRerenderKey: number
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey: number) => void
  showImportDSLModal: boolean
  setShowImportDSLModal: (showImportDSLModal: boolean) => void
  showTips: string
  setShowTips: (showTips: string) => void
}

export const createWorkflowSlice: StateCreator<WorkflowSliceShape> = set => ({
  appId: '',
  workflowRunningData: undefined,
  setWorkflowRunningData: workflowRunningData => set(() => ({ workflowRunningData })),
  notInitialWorkflow: false,
  setNotInitialWorkflow: notInitialWorkflow => set(() => ({ notInitialWorkflow })),
  clipboardElements: [],
  setClipboardElements: clipboardElements => set(() => ({ clipboardElements })),
  selection: null,
  setSelection: selection => set(() => ({ selection })),
  bundleNodeSize: null,
  setBundleNodeSize: bundleNodeSize => set(() => ({ bundleNodeSize })),
  controlMode: localStorage.getItem('workflow-operation-mode') === 'pointer' ? 'pointer' : 'hand',
  setControlMode: (controlMode) => {
    set(() => ({ controlMode }))
    localStorage.setItem('workflow-operation-mode', controlMode)
  },
  mousePosition: { pageX: 0, pageY: 0, elementX: 0, elementY: 0 },
  setMousePosition: mousePosition => set(() => ({ mousePosition })),
  showConfirm: undefined,
  setShowConfirm: showConfirm => set(() => ({ showConfirm })),
  controlPromptEditorRerenderKey: 0,
  setControlPromptEditorRerenderKey: controlPromptEditorRerenderKey => set(() => ({ controlPromptEditorRerenderKey })),
  showImportDSLModal: false,
  setShowImportDSLModal: showImportDSLModal => set(() => ({ showImportDSLModal })),
  showTips: '',
  setShowTips: showTips => set(() => ({ showTips })),
})
