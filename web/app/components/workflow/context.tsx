'use client'

import { createContext, useContext } from 'use-context-selector'
import type { Edge } from 'reactflow'
import type {
  BlockEnum,
  Node,
} from './types'

export type WorkflowContextValue = {
  mode: string
  nodes: Node[]
  edges: Edge[]
  selectedNode?: Node
  handleAddNextNode: (prevNode: Node, nextNodeType: BlockEnum) => void
  handleUpdateNodeData: (nodeId: string, data: Node['data']) => void
}

export const WorkflowContext = createContext<WorkflowContextValue>({
  mode: 'workflow',
  nodes: [],
  edges: [],
  handleAddNextNode: () => {},
  handleUpdateNodeData: () => {},
})
export const useWorkflowContext = () => useContext(WorkflowContext)
