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
import type {
  Edge,
  HistoryWorkflowData,
  Node,
  RunFile,
  ToolWithProvider,
  WorkflowRunningData,
} from './types'
import { WorkflowContext } from './context'

type Shape = {
  appId: string
  workflowRunningData?: WorkflowRunningData
  setWorkflowRunningData: (workflowData: WorkflowRunningData) => void
  historyWorkflowData?: HistoryWorkflowData
  setHistoryWorkflowData: (historyWorkflowData: HistoryWorkflowData) => void
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
  files: RunFile[]
  setFiles: (files: RunFile[]) => void
  backupDraft?: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    features: Record<string, any>
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
  clipboardElements: Node[]
  setClipboardElements: (clipboardElements: Node[]) => void
  shortcutsDisabled: boolean
  setShortcutsDisabled: (shortcutsDisabled: boolean) => void
}

export const createWorkflowStore = () => {
  return createStore<Shape>(set => ({
    appId: '',
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
    clipboardElements: [],
    setClipboardElements: clipboardElements => set(() => ({ clipboardElements })),
    shortcutsDisabled: false,
    setShortcutsDisabled: shortcutsDisabled => set(() => ({ shortcutsDisabled })),
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
