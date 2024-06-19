import { type ReactNode, createContext, useContext, useMemo, useState } from 'react'
import { type StoreApi, create } from 'zustand'
import { type TemporalState, temporal } from 'zundo'
import isDeepEqual from 'fast-deep-equal'
import type { Edge, Node } from './types'
import type { WorkflowHistoryEvent } from './hooks'

export const WorkflowHistoryStoreContext = createContext<ReturnType<typeof createStore> | null>(null)
export const Provider = WorkflowHistoryStoreContext.Provider

export function WorkflowHistoryProvider({
  nodes,
  edges,
  children,
}: WorkflowWithHistoryProviderProps) {
  const [store] = useState(() =>
    createStore({
      nodes,
      edges,
    }),
  )

  return (
    <Provider value={store}>
      {children}
    </Provider>
  )
}

export function useWorkflowHistoryStore() {
  const store: WorkflowHistoryStoreApi | null = useContext(WorkflowHistoryStoreContext)
  if (store === null)
    throw new Error('useWorkflowHistoryStoreApi must be used within a WorkflowHistoryProvider')

  return useMemo(
    () => ({
      getState: store.getState,
      setState: (state: WorkflowHistoryState) => {
        store.setState({
          workflowHistoryEvent: state.workflowHistoryEvent,
          nodes: state.nodes.map((node: Node) => ({ ...node, data: { ...node.data, selected: false } })),
          edges: state.edges.map((edge: Edge) => ({ ...edge, selected: false }) as Edge),
        })
      },
      subscribe: store.subscribe,
      temporal: store.temporal,
    }),
    [store],
  )
}

function createStore({
  nodes: storeNodes,
  edges: storeEdges,
}: {
  nodes: Node[]
  edges: Edge[]
}): WorkflowHistoryStoreApi {
  const store = create(temporal<WorkflowHistoryState>(
    (set, get) => {
      return {
        workflowHistoryEvent: undefined,
        nodes: storeNodes,
        edges: storeEdges,
        getNodes: () => get().nodes,
        setNodes: (nodes: Node[]) => set({ nodes }),
        setEdges: (edges: Edge[]) => set({ edges }),
      }
    },
    {
      equality: (pastState, currentState) =>
        isDeepEqual(pastState, currentState),
    },
  ),
  )

  return store
}

export type WorkflowHistoryStore = {
  nodes: Node[]
  edges: Edge[]
  workflowHistoryEvent: WorkflowHistoryEvent | undefined
}

export type WorkflowHistoryActions = {
  setNodes?: (nodes: Node[]) => void
  setEdges?: (edges: Edge[]) => void
}

export type WorkflowHistoryState = WorkflowHistoryStore & WorkflowHistoryActions

export type WorkflowHistoryStoreApi = StoreApi<WorkflowHistoryState> & { temporal: StoreApi<TemporalState<WorkflowHistoryState>> }

export type WorkflowWithHistoryProviderProps = {
  nodes: Node[]
  edges: Edge[]
  children: ReactNode
}
