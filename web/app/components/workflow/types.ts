import type { Node as ReactFlowNode } from 'reactflow'
import type { Resolution } from '@/types/app'

export enum BlockEnum {
  Start = 'start',
  End = 'end',
  DirectAnswer = 'direct-answer',
  LLM = 'llm',
  KnowledgeRetrieval = 'knowledge-retrieval',
  QuestionClassifier = 'question-classifier',
  IfElse = 'if-else',
  Code = 'code',
  TemplateTransform = 'template-transform',
  HttpRequest = 'http-request',
  VariableAssigner = 'variable-assigner',
  Tool = 'tool',
}

export type NodeData = {
  type: BlockEnum
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

export type Block = {
  classification?: string
  type: BlockEnum
  title: string
  description?: string
}
