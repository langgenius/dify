import type { StateCreator } from 'zustand'
import type { WorkflowHistoryEventT } from '../../hooks/use-workflow-history'
import type { Edge, Node } from '../../types'
import type {
  HistoryWorkflowData,
} from '@/app/components/workflow/types'
import type {
  VersionHistory,
} from '@/types/workflow'
import isDeepEqual from 'fast-deep-equal'

export type WorkflowHistoryEventMeta = {
  nodeId?: string
  nodeTitle?: string
}

export type WorkflowHistoryState = {
  nodes: Node[]
  edges: Edge[]
  workflowHistoryEvent: WorkflowHistoryEventT | undefined
  workflowHistoryEventMeta?: WorkflowHistoryEventMeta
}

export type WorkflowHistoryTemporalState = Pick<HistorySliceShape, 'workflowHistory'>

export const getWorkflowHistoryTemporalState = (state: HistorySliceShape): WorkflowHistoryTemporalState => ({
  workflowHistory: state.workflowHistory,
})

export const isWorkflowHistoryTemporalStateEqual = (
  pastState: WorkflowHistoryTemporalState,
  currentState: WorkflowHistoryTemporalState,
) => {
  if (pastState.workflowHistory === currentState.workflowHistory)
    return true

  return isDeepEqual(pastState.workflowHistory, currentState.workflowHistory)
}

export type HistorySliceShape = {
  workflowHistory: WorkflowHistoryState
  setWorkflowHistory: (workflowHistory: WorkflowHistoryState) => void
  historyShortcutsEnabled: boolean
  setHistoryShortcutsEnabled: (enabled: boolean) => void
  historyWorkflowData?: HistoryWorkflowData
  setHistoryWorkflowData: (historyWorkflowData?: HistoryWorkflowData) => void
  showRunHistory: boolean
  setShowRunHistory: (showRunHistory: boolean) => void
  versionHistory: VersionHistory[]
  setVersionHistory: (versionHistory: VersionHistory[]) => void
}

export const createHistorySlice: StateCreator<HistorySliceShape> = set => ({
  workflowHistory: {
    nodes: [],
    edges: [],
    workflowHistoryEvent: undefined,
    workflowHistoryEventMeta: undefined,
  },
  setWorkflowHistory: workflowHistory => set(() => ({ workflowHistory })),
  historyShortcutsEnabled: true,
  setHistoryShortcutsEnabled: historyShortcutsEnabled => set(() => ({ historyShortcutsEnabled })),
  historyWorkflowData: undefined,
  setHistoryWorkflowData: historyWorkflowData => set(() => ({ historyWorkflowData })),
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
  versionHistory: [],
  setVersionHistory: versionHistory => set(() => ({ versionHistory })),
})
