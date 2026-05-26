import type { TemporalState } from 'zundo'
import type {
  WorkflowHistoryState,
} from './store/workflow/history-slice'
import type { Edge, Node } from './types'
import { use, useMemo } from 'react'
import { WorkflowContext } from './context'

type WorkflowHistoryTemporalSnapshot = {
  workflowHistory: WorkflowHistoryState
}

type WorkflowHistoryTemporalStore = {
  getState: () => TemporalState<WorkflowHistoryState>
  subscribe: (listener: (state: TemporalState<WorkflowHistoryState>) => void) => () => void
}

type WorkflowHistoryStore = {
  getState: () => WorkflowHistoryState
  setState: (state: WorkflowHistoryState) => void
  subscribe: (listener: (state: WorkflowHistoryState) => void) => () => void
  temporal: WorkflowHistoryTemporalStore
}

const sanitizeWorkflowHistory = (state: WorkflowHistoryState): WorkflowHistoryState => ({
  workflowHistoryEvent: state.workflowHistoryEvent,
  workflowHistoryEventMeta: state.workflowHistoryEventMeta,
  nodes: state.nodes.map((node: Node) => ({
    ...node,
    data: {
      ...node.data,
      selected: false,
    },
  })),
  edges: state.edges.map((edge: Edge) => ({
    ...edge,
    selected: false,
  }) as Edge),
})

const toHistoryState = (
  state?: Partial<WorkflowHistoryTemporalSnapshot>,
): Partial<WorkflowHistoryState> => {
  return state?.workflowHistory ?? {}
}

const toTemporalState = (
  temporalState: TemporalState<WorkflowHistoryTemporalSnapshot>,
): TemporalState<WorkflowHistoryState> => ({
  pastStates: temporalState.pastStates.map(toHistoryState),
  futureStates: temporalState.futureStates.map(toHistoryState),
  undo: temporalState.undo,
  redo: temporalState.redo,
  clear: temporalState.clear,
  isTracking: temporalState.isTracking,
  pause: temporalState.pause,
  resume: temporalState.resume,
  setOnSave: onSave => temporalState.setOnSave(
    onSave
      ? (pastState, currentState) => {
          onSave(
            toHistoryState(pastState) as WorkflowHistoryState,
            toHistoryState(currentState) as WorkflowHistoryState,
          )
        }
      : undefined,
  ),
})

export function useWorkflowHistoryStore() {
  const workflowStore = use(WorkflowContext)

  if (!workflowStore)
    throw new Error('Missing WorkflowContext.Provider in the tree')

  return {
    store: useMemo(
      () => ({
        getState: () => workflowStore.getState().workflowHistory,
        setState: (state: WorkflowHistoryState) => {
          workflowStore.getState().setWorkflowHistory(sanitizeWorkflowHistory(state))
        },
        subscribe: (listener: (state: WorkflowHistoryState) => void) => {
          return workflowStore.subscribe((state, previousState) => {
            if (state.workflowHistory !== previousState.workflowHistory)
              listener(state.workflowHistory)
          })
        },
        temporal: {
          getState: () => toTemporalState(workflowStore.temporal.getState()),
          subscribe: listener => workflowStore.temporal.subscribe((state) => {
            listener(toTemporalState(state))
          }),
        },
      }) satisfies WorkflowHistoryStore,
      [workflowStore],
    ),
  }
}
