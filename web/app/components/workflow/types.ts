import type { Node as ReactFlowNode } from 'reactflow'
import type { Resolution } from '@/types/app'
export type NodeData = {
  type: string
  name?: string
  icon?: any
  description?: string
}
export type Node = ReactFlowNode<NodeData>

export type ValueSelector = string[] // [nodeId, key | obj key path]

export type Variable = {
  variable: string
  value_selector: ValueSelector
}

export type ModelConfig = {
  provider: string
  name: string
  mode: string
  completion_params: Record<string, any>
}

export enum PromptRole {
  system = 'system',
  user = 'user',
  assistant = 'assistant',
}

export type PromptItem = {
  role?: PromptRole
  text: string
}

export enum MemoryRole {
  user = 'user',
  assistant = 'assistant',
}

export type Memory = {
  role_prefix: MemoryRole
  window: {
    enabled: boolean
    size: number
  }
}

export type LLMNodeData = {
  title: string
  desc: string
  type: string
  model: ModelConfig
  variables: Variable[]
  prompt: PromptItem[] | PromptItem
  memory: Memory
  context: {
    enabled: boolean
    size: number
  }
  vision: {
    enabled: boolean
    variable_selector: ValueSelector
    configs: {
      detail: Resolution
    }
  }
}
