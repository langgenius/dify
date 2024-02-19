'use client'

import { createContext, useContext } from 'use-context-selector'
import type {
  Edge,
  ReactFlowInstance,
} from 'reactflow'
import type {
  BlockEnum,
  Node,
} from './types'

export type WorkflowContextValue = {
  reactFlow: ReactFlowInstance
  nodes: Node[]
  edges: Edge[]
  selectedNodeId?: string
  handleSelectedNodeIdChange: (nodeId: string) => void
  selectedNode?: Node
  handleAddNextNode: (prevNode: Node, nextNodeType: BlockEnum) => void
}

export const WorkflowContext = createContext<WorkflowContextValue>({
  reactFlow: null as any,
  nodes: [],
  edges: [],
  handleSelectedNodeIdChange: () => {},
  handleAddNextNode: () => {},
})
export const useWorkflowContext = () => useContext(WorkflowContext)
