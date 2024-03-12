import { create } from 'zustand'
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
import type { WorkflowRunningStatus } from './types'

type State = {
  mode: Mode
  taskId: string
  currentSequenceNumber: number
  workflowRunId: string
  showRunHistory: boolean
  showFeaturesPanel: boolean
  isDragging: boolean
  helpLineHorizontal?: HelpLineHorizontalPosition
  helpLineVertical?: HelpLineVerticalPosition
  toolsets: CollectionWithExpanded[]
  toolsMap: ToolsMap
  draftUpdatedAt: number
  publishedAt: number
  runningStatus?: WorkflowRunningStatus
  showInputsPanel: boolean
  inputs: Record<string, string>
}

type Action = {
  setMode: (mode: Mode) => void
  setTaskId: (taskId: string) => void
  setCurrentSequenceNumber: (currentSequenceNumber: number) => void
  setWorkflowRunId: (workflowRunId: string) => void
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  setIsDragging: (isDragging: boolean) => void
  setHelpLineHorizontal: (helpLineHorizontal?: HelpLineHorizontalPosition) => void
  setHelpLineVertical: (helpLineVertical?: HelpLineVerticalPosition) => void
  setToolsets: (toolsets: CollectionWithExpanded[]) => void
  setToolsMap: (toolsMap: Record<string, ToolInWorkflow[]>) => void
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
  setPublishedAt: (publishedAt: number) => void
  setRunningStatus: (runningStatus?: WorkflowRunningStatus) => void
  setShowInputsPanel: (showInputsPanel: boolean) => void
  setInputs: (inputs: Record<string, string>) => void
}

export const useStore = create<State & Action>(set => ({
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
  isDragging: false,
  setIsDragging: isDragging => set(() => ({ isDragging })),
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
}))
