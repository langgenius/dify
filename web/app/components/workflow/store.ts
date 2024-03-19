import { useContext } from 'react'
import {
  create,
  useStore as useZustandStore,
} from 'zustand'
import { debounce } from 'lodash-es'
import type { Viewport } from 'reactflow'
import type {
  HelpLineHorizontalPosition,
  HelpLineVerticalPosition,
} from './help-line/types'
import type {
  CollectionWithExpanded,
  ToolInWorkflow,
  ToolsMap,
} from './block-selector/types'
import type {
  Edge,
  Node,
  RunFile,
  WorkflowRunningStatus,
} from './types'
import { WorkflowContext } from './context'

type State = {
  taskId: string
  currentSequenceNumber: number
  workflowRunId: string
  currentConversationID: string
  showRunHistory: boolean
  showFeaturesPanel: boolean
  helpLineHorizontal?: HelpLineHorizontalPosition
  helpLineVertical?: HelpLineVerticalPosition
  toolsets: CollectionWithExpanded[]
  toolsMap: ToolsMap
  draftUpdatedAt: number
  publishedAt: number
  runningStatus?: WorkflowRunningStatus
  showInputsPanel: boolean
  inputs: Record<string, string>
  files: RunFile[]
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  notInitialWorkflow: boolean
  nodesDefaultConfigs: Record<string, any>
  nodeAnimation: boolean
  isRestoring: boolean
}

type Action = {
  setTaskId: (taskId: string) => void
  setCurrentSequenceNumber: (currentSequenceNumber: number) => void
  setWorkflowRunId: (workflowRunId: string) => void
  setCurrentConversationID: (currentConversationID: string) => void
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  setHelpLineHorizontal: (helpLineHorizontal?: HelpLineHorizontalPosition) => void
  setHelpLineVertical: (helpLineVertical?: HelpLineVerticalPosition) => void
  setToolsets: (toolsets: CollectionWithExpanded[]) => void
  setToolsMap: (toolsMap: Record<string, ToolInWorkflow[]>) => void
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
  setPublishedAt: (publishedAt: number) => void
  setRunningStatus: (runningStatus?: WorkflowRunningStatus) => void
  setShowInputsPanel: (showInputsPanel: boolean) => void
  setInputs: (inputs: Record<string, string>) => void
  setFiles: (files: RunFile[]) => void
  setBackupDraft: (backupDraft?: State['backupDraft']) => void
  setNotInitialWorkflow: (notInitialWorkflow: boolean) => void
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  setNodeAnimation: (nodeAnimation: boolean) => void
  setIsRestoring: (isRestoring: boolean) => void
  debouncedSyncWorkflowDraft: (fn: () => void) => void
}

export const createWorkflowStore = () => {
  return create<State & Action>(set => ({
    taskId: '',
    setTaskId: taskId => set(() => ({ taskId })),
    currentSequenceNumber: 0,
    setCurrentSequenceNumber: currentSequenceNumber => set(() => ({ currentSequenceNumber })),
    workflowRunId: '',
    setWorkflowRunId: workflowRunId => set(() => ({ workflowRunId })),
    currentConversationID: '',
    setCurrentConversationID: currentConversationID => set(() => ({ currentConversationID })),
    showRunHistory: false,
    setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
    showFeaturesPanel: false,
    setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
    helpLineHorizontal: undefined,
    setHelpLineHorizontal: helpLineHorizontal => set(() => ({ helpLineHorizontal })),
    helpLineVertical: undefined,
    setHelpLineVertical: helpLineVertical => set(() => ({ helpLineVertical })),
    toolsets: [],
    setToolsets: toolsets => set(() => ({ toolsets })),
    toolsMap: {},
    setToolsMap: toolsMap => set(() => ({ toolsMap })),
    draftUpdatedAt: 0,
    setDraftUpdatedAt: draftUpdatedAt => set(() => ({ draftUpdatedAt: draftUpdatedAt ? draftUpdatedAt * 1000 : 0 })),
    publishedAt: 0,
    setPublishedAt: publishedAt => set(() => ({ publishedAt: publishedAt ? publishedAt * 1000 : 0 })),
    runningStatus: undefined,
    setRunningStatus: runningStatus => set(() => ({ runningStatus })),
    showInputsPanel: false,
    setShowInputsPanel: showInputsPanel => set(() => ({ showInputsPanel })),
    inputs: {},
    setInputs: inputs => set(() => ({ inputs })),
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
  }))
}

export function useStore<T>(selector: (state: State & Action) => T): T {
  const store = useContext(WorkflowContext)
  if (!store)
    throw new Error('Missing WorkflowContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useWorkflowStore = () => {
  return useContext(WorkflowContext)!
}
