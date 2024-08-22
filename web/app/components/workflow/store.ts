import { useContext } from 'react'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { debounce } from 'lodash-es'
import type { Viewport } from 'reactflow'
import type {
  HelpLineHorizontalPosition,
  HelpLineVerticalPosition,
} from './help-line/types'
import type { VariableAssignerNodeType } from './nodes/variable-assigner/types'
import type {
  ConversationVariable,
  Edge,
  EnvironmentVariable,
  HistoryWorkflowData,
  Node,
  RunFile,
  ToolWithProvider,
  WorkflowRunningData,
} from './types'
import { WorkflowContext } from './context'

// #TODO chatVar#
// const MOCK_DATA = [
//   {
//     id: 'fjlaksdjflkjg-dfjlajfl0dnfkafjk-djfdkafj-djfak',
//     name: 'chat_history',
//     value_type: 'array[message]',
//     value: [],
//     description: 'The chat history of the conversation',
//   },
//   {
//     id: 'fljdaklfjl-dfjlafj0-dklajglje-eknglh',
//     name: 'order_id',
//     value: '123456',
//     value_type: 'string',
//     description: '',
//   },
// ]

type PreviewRunningData = WorkflowRunningData & {
  resultTabActive?: boolean
  resultText?: string
}

type Shape = {
  appId: string
  panelWidth: number
  showSingleRunPanel: boolean
  setShowSingleRunPanel: (showSingleRunPanel: boolean) => void
  workflowRunningData?: PreviewRunningData
  setWorkflowRunningData: (workflowData: PreviewRunningData) => void
  historyWorkflowData?: HistoryWorkflowData
  setHistoryWorkflowData: (historyWorkflowData?: HistoryWorkflowData) => void
  showRunHistory: boolean
  setShowRunHistory: (showRunHistory: boolean) => void
  showFeaturesPanel: boolean
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  helpLineHorizontal?: HelpLineHorizontalPosition
  setHelpLineHorizontal: (helpLineHorizontal?: HelpLineHorizontalPosition) => void
  helpLineVertical?: HelpLineVerticalPosition
  setHelpLineVertical: (helpLineVertical?: HelpLineVerticalPosition) => void
  draftUpdatedAt: number
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
  publishedAt: number
  setPublishedAt: (publishedAt: number) => void
  showInputsPanel: boolean
  setShowInputsPanel: (showInputsPanel: boolean) => void
  inputs: Record<string, string>
  setInputs: (inputs: Record<string, string>) => void
  toolPublished: boolean
  setToolPublished: (toolPublished: boolean) => void
  files: RunFile[]
  setFiles: (files: RunFile[]) => void
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    features: Record<string, any>
    environmentVariables: EnvironmentVariable[]
  }
  setBackupDraft: (backupDraft?: Shape['backupDraft']) => void
  notInitialWorkflow: boolean
  setNotInitialWorkflow: (notInitialWorkflow: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  nodeAnimation: boolean
  setNodeAnimation: (nodeAnimation: boolean) => void
  isRestoring: boolean
  setIsRestoring: (isRestoring: boolean) => void
  debouncedSyncWorkflowDraft: (fn: () => void) => void
  buildInTools: ToolWithProvider[]
  setBuildInTools: (tools: ToolWithProvider[]) => void
  customTools: ToolWithProvider[]
  setCustomTools: (tools: ToolWithProvider[]) => void
  workflowTools: ToolWithProvider[]
  setWorkflowTools: (tools: ToolWithProvider[]) => void
  clipboardElements: Node[]
  setClipboardElements: (clipboardElements: Node[]) => void
  showDebugAndPreviewPanel: boolean
  setShowDebugAndPreviewPanel: (showDebugAndPreviewPanel: boolean) => void
  showEnvPanel: boolean
  setShowEnvPanel: (showEnvPanel: boolean) => void
  environmentVariables: EnvironmentVariable[]
  setEnvironmentVariables: (environmentVariables: EnvironmentVariable[]) => void
  envSecrets: Record<string, string>
  setEnvSecrets: (envSecrets: Record<string, string>) => void
  showChatVariablePanel: boolean
  setShowChatVariablePanel: (showChatVariablePanel: boolean) => void
  conversationVariables: ConversationVariable[]
  setConversationVariables: (conversationVariables: ConversationVariable[]) => void
  selection: null | { x1: number; y1: number; x2: number; y2: number }
  setSelection: (selection: Shape['selection']) => void
  bundleNodeSize: { width: number; height: number } | null
  setBundleNodeSize: (bundleNodeSize: Shape['bundleNodeSize']) => void
  controlMode: 'pointer' | 'hand'
  setControlMode: (controlMode: Shape['controlMode']) => void
  candidateNode?: Node
  setCandidateNode: (candidateNode?: Node) => void
  panelMenu?: {
    top: number
    left: number
  }
  setPanelMenu: (panelMenu: Shape['panelMenu']) => void
  nodeMenu?: {
    top: number
    left: number
    nodeId: string
  }
  setNodeMenu: (nodeMenu: Shape['nodeMenu']) => void
  mousePosition: { pageX: number; pageY: number; elementX: number; elementY: number }
  setMousePosition: (mousePosition: Shape['mousePosition']) => void
  syncWorkflowDraftHash: string
  setSyncWorkflowDraftHash: (hash: string) => void
  showConfirm?: { title: string; desc?: string; onConfirm: () => void }
  setShowConfirm: (showConfirm: Shape['showConfirm']) => void
  showAssignVariablePopup?: {
    nodeId: string
    nodeData: Node['data']
    variableAssignerNodeId: string
    variableAssignerNodeData: VariableAssignerNodeType
    variableAssignerNodeHandleId: string
    parentNode?: Node
    x: number
    y: number
  }
  setShowAssignVariablePopup: (showAssignVariablePopup: Shape['showAssignVariablePopup']) => void
  hoveringAssignVariableGroupId?: string
  setHoveringAssignVariableGroupId: (hoveringAssignVariableGroupId?: string) => void
  connectingNodePayload?: { nodeId: string; nodeType: string; handleType: string; handleId: string | null }
  setConnectingNodePayload: (startConnectingPayload?: Shape['connectingNodePayload']) => void
  enteringNodePayload?: {
    nodeId: string
    nodeData: VariableAssignerNodeType
  }
  setEnteringNodePayload: (enteringNodePayload?: Shape['enteringNodePayload']) => void
  isSyncingWorkflowDraft: boolean
  setIsSyncingWorkflowDraft: (isSyncingWorkflowDraft: boolean) => void
  controlPromptEditorRerenderKey: number
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey: number) => void
  showImportDSLModal: boolean
  setShowImportDSLModal: (showImportDSLModal: boolean) => void
}

export const createWorkflowStore = () => {
  return createStore<Shape>(set => ({
    appId: '',
    panelWidth: localStorage.getItem('workflow-node-panel-width') ? parseFloat(localStorage.getItem('workflow-node-panel-width')!) : 420,
    showSingleRunPanel: false,
    setShowSingleRunPanel: showSingleRunPanel => set(() => ({ showSingleRunPanel })),
    workflowRunningData: undefined,
    setWorkflowRunningData: workflowRunningData => set(() => ({ workflowRunningData })),
    historyWorkflowData: undefined,
    setHistoryWorkflowData: historyWorkflowData => set(() => ({ historyWorkflowData })),
    showRunHistory: false,
    setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
    showFeaturesPanel: false,
    setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
    helpLineHorizontal: undefined,
    setHelpLineHorizontal: helpLineHorizontal => set(() => ({ helpLineHorizontal })),
    helpLineVertical: undefined,
    setHelpLineVertical: helpLineVertical => set(() => ({ helpLineVertical })),
    draftUpdatedAt: 0,
    setDraftUpdatedAt: draftUpdatedAt => set(() => ({ draftUpdatedAt: draftUpdatedAt ? draftUpdatedAt * 1000 : 0 })),
    publishedAt: 0,
    setPublishedAt: publishedAt => set(() => ({ publishedAt: publishedAt ? publishedAt * 1000 : 0 })),
    showInputsPanel: false,
    setShowInputsPanel: showInputsPanel => set(() => ({ showInputsPanel })),
    inputs: {},
    setInputs: inputs => set(() => ({ inputs })),
    toolPublished: false,
    setToolPublished: toolPublished => set(() => ({ toolPublished })),
    files: [],
    setFiles: files => set(() => ({ files })),
    backupDraft: undefined,
    setBackupDraft: backupDraft => set(() => ({ backupDraft })),
    notInitialWorkflow: false,
    setNotInitialWorkflow: notInitialWorkflow => set(() => ({ notInitialWorkflow })),
    nodesDefaultConfigs: {},
    setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
    nodeAnimation: false,
    setNodeAnimation: nodeAnimation => set(() => ({ nodeAnimation })),
    isRestoring: false,
    setIsRestoring: isRestoring => set(() => ({ isRestoring })),
    debouncedSyncWorkflowDraft: debounce((syncWorkflowDraft) => {
      syncWorkflowDraft()
    }, 5000),
    buildInTools: [],
    setBuildInTools: buildInTools => set(() => ({ buildInTools })),
    customTools: [],
    setCustomTools: customTools => set(() => ({ customTools })),
    workflowTools: [],
    setWorkflowTools: workflowTools => set(() => ({ workflowTools })),
    clipboardElements: [],
    setClipboardElements: clipboardElements => set(() => ({ clipboardElements })),
    showDebugAndPreviewPanel: false,
    setShowDebugAndPreviewPanel: showDebugAndPreviewPanel => set(() => ({ showDebugAndPreviewPanel })),
    showEnvPanel: false,
    setShowEnvPanel: showEnvPanel => set(() => ({ showEnvPanel })),
    environmentVariables: [],
    setEnvironmentVariables: environmentVariables => set(() => ({ environmentVariables })),
    envSecrets: {},
    setEnvSecrets: envSecrets => set(() => ({ envSecrets })),
    showChatVariablePanel: false,
    setShowChatVariablePanel: showChatVariablePanel => set(() => ({ showChatVariablePanel })),
    conversationVariables: [],
    setConversationVariables: conversationVariables => set(() => ({ conversationVariables })),
    selection: null,
    setSelection: selection => set(() => ({ selection })),
    bundleNodeSize: null,
    setBundleNodeSize: bundleNodeSize => set(() => ({ bundleNodeSize })),
    controlMode: localStorage.getItem('workflow-operation-mode') === 'pointer' ? 'pointer' : 'hand',
    setControlMode: (controlMode) => {
      set(() => ({ controlMode }))
      localStorage.setItem('workflow-operation-mode', controlMode)
    },
    candidateNode: undefined,
    setCandidateNode: candidateNode => set(() => ({ candidateNode })),
    panelMenu: undefined,
    setPanelMenu: panelMenu => set(() => ({ panelMenu })),
    nodeMenu: undefined,
    setNodeMenu: nodeMenu => set(() => ({ nodeMenu })),
    mousePosition: { pageX: 0, pageY: 0, elementX: 0, elementY: 0 },
    setMousePosition: mousePosition => set(() => ({ mousePosition })),
    syncWorkflowDraftHash: '',
    setSyncWorkflowDraftHash: syncWorkflowDraftHash => set(() => ({ syncWorkflowDraftHash })),
    showConfirm: undefined,
    setShowConfirm: showConfirm => set(() => ({ showConfirm })),
    showAssignVariablePopup: undefined,
    setShowAssignVariablePopup: showAssignVariablePopup => set(() => ({ showAssignVariablePopup })),
    hoveringAssignVariableGroupId: undefined,
    setHoveringAssignVariableGroupId: hoveringAssignVariableGroupId => set(() => ({ hoveringAssignVariableGroupId })),
    connectingNodePayload: undefined,
    setConnectingNodePayload: connectingNodePayload => set(() => ({ connectingNodePayload })),
    enteringNodePayload: undefined,
    setEnteringNodePayload: enteringNodePayload => set(() => ({ enteringNodePayload })),
    isSyncingWorkflowDraft: false,
    setIsSyncingWorkflowDraft: isSyncingWorkflowDraft => set(() => ({ isSyncingWorkflowDraft })),
    controlPromptEditorRerenderKey: 0,
    setControlPromptEditorRerenderKey: controlPromptEditorRerenderKey => set(() => ({ controlPromptEditorRerenderKey })),
    showImportDSLModal: false,
    setShowImportDSLModal: showImportDSLModal => set(() => ({ showImportDSLModal })),
  }))
}

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = useContext(WorkflowContext)
  if (!store)
    throw new Error('Missing WorkflowContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useWorkflowStore = () => {
  return useContext(WorkflowContext)!
}
