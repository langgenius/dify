import type { Node as ReactFlowNode } from 'reactflow'

export type NodeData = {
  type: string
  name?: string
  icon?: any
  description?: string
}
export type Node = ReactFlowNode<NodeData>
