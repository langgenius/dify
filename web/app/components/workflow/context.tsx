'use client'

import { createContext, useContext } from 'use-context-selector'
import type { Edge } from 'reactflow'
import type { Node } from './types'

export type WorkflowContextValue = {
  nodes: Node[]
  edges: Edge[]
  selectedNodeId?: string
  handleSelectedNodeIdChange: (nodeId: string) => void
  selectedNode?: Node
}

export const WorkflowContext = createContext<WorkflowContextValue>({
  nodes: [],
  edges: [],
  handleSelectedNodeIdChange: () => {},
})
export const useWorkflowContext = () => useContext(WorkflowContext)
