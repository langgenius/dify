import {
  create,
  useStore as useZustandStore,
} from 'zustand'
import type { Viewport } from 'reactflow'
import { useContext } from 'react'
import type {
  HelpLineHorizontalPosition,
  HelpLineVerticalPosition,
} from './help-line/types'
import type {
  CollectionWithExpanded,
  ToolInWorkflow,
  ToolsMap,
} from './block-selector/types'
import { Mode } from './types'
import type {
  Edge,
  Node,
  WorkflowRunningStatus,
} from './types'
import { WorkflowContext } from './context'

type State = {
  mode: Mode
  taskId: string
  currentSequenceNumber: number
  workflowRunId: string
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
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  notInitialWorkflow: boolean
  nodesDefaultConfigs: Record<string, any>
}

type Action = {
  setMode: (mode: Mode) => void
  setTaskId: (taskId: string) => void
  setCurrentSequenceNumber: (currentSequenceNumber: number) => void
  setWorkflowRunId: (workflowRunId: string) => void
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
  setBackupDraft: (backupDraft?: State['backupDraft']) => void
  setNotInitialWorkflow: (notInitialWorkflow: boolean) => void
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
}

export const createWorkflowStore = () => {
  return create<State & Action>(set => ({
    mode: Mode.Editing,
    taskId: '',
    setTaskId: taskId => set(() => ({ taskId })),
    currentSequenceNumber: 0,
    setCurrentSequenceNumber: currentSequenceNumber => set(() => ({ currentSequenceNumber })),
    workflowRunId: '',
    setWorkflowRunId: workflowRunId => set(() => ({ workflowRunId })),
    setMode: mode => set(() => ({ mode })),
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
    setDraftUpdatedAt: draftUpdatedAt => set(() => ({ draftUpdatedAt })),
    publishedAt: 0,
    setPublishedAt: publishedAt => set(() => ({ publishedAt })),
    runningStatus: undefined,
    setRunningStatus: runningStatus => set(() => ({ runningStatus })),
    showInputsPanel: false,
    setShowInputsPanel: showInputsPanel => set(() => ({ showInputsPanel })),
    inputs: {},
    setInputs: inputs => set(() => ({ inputs })),
    backupDraft: undefined,
    setBackupDraft: backupDraft => set(() => ({ backupDraft })),
    notInitialWorkflow: false,
    setNotInitialWorkflow: notInitialWorkflow => set(() => ({ notInitialWorkflow })),
    nodesDefaultConfigs: {},
    setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
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
