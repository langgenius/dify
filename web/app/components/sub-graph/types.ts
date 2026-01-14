import type { StateCreator } from 'zustand'
import type { MentionConfig } from '@/app/components/workflow/nodes/_base/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Edge, Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'

export type SubGraphProps = {
  toolNodeId: string
  paramKey: string
  sourceVariable: ValueSelector
  agentNodeId: string
  agentName: string
  mentionConfig: MentionConfig
  onMentionConfigChange: (config: MentionConfig) => void
  extractorNode?: Node<LLMNodeType>
  toolParamValue?: string
  parentAvailableNodes?: Node[]
  parentAvailableVars?: NodeOutPutVar[]
  onSave?: (nodes: Node[], edges: Edge[]) => void
}

export type SubGraphSliceShape = {
  parentAvailableVars: NodeOutPutVar[]
  parentAvailableNodes: Node[]
  setParentAvailableVars: (vars: NodeOutPutVar[]) => void
  setParentAvailableNodes: (nodes: Node[]) => void
}

export type CreateSubGraphSlice = StateCreator<SubGraphSliceShape>
