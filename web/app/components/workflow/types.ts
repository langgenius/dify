import type {
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
} from 'reactflow'
import type { Collection } from '@/app/components/tools/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'

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

export type Branch = {
  id: string
  name: string
}

export type CommonNodeType<T = {}> = {
  _selected?: boolean
  _targetBranches?: Branch[]
  _isSingleRun?: boolean
  _icon?: Collection['icon']
  _about?: string
  _author?: string
  title: string
  desc: string
  type: BlockEnum
} & T

export type CommonEdgeType = {
  _hovering: boolean
  _connectedNodeIsHovering: boolean
}

export type Node = ReactFlowNode<CommonNodeType>
export type SelectedNode = Pick<Node, 'id' | 'data'>
export type NodeProps<T = unknown> = { id: string; data: CommonNodeType<T> }
export type NodePanelProps<T> = {
  id: string
  data: CommonNodeType<T>
}
export type Edge = ReactFlowEdge<CommonEdgeType>

export type ValueSelector = string[] // [nodeId, key | obj key path]

export type Variable = {
  variable: string
  value_selector: ValueSelector
}

export type VariableWithValue = {
  key: string
  value: string
}

export enum InputVarType {
  textInput = 'text-input',
  paragraph = 'paragraph',
  select = 'select',
  number = 'number',
  url = 'url',
  files = 'files',
  contexts = 'contexts', // knowledge retrieval
}

export type InputVar = {
  type: InputVarType
  label: string
  variable: string
  max_length?: number
  default?: string
  required: boolean
  hint?: string
  options?: string[]
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

export type RolePrefix = {
  user: string
  assistant: string
}

export type Memory = {
  role_prefix?: RolePrefix
  window: {
    enabled: boolean
    size: number | string | null
  }
}

export type Var = {
  variable: string
  type: string
  children?: Var[] // if type is obj, has the children struct
}

export type NodeOutPutVar = {
  nodeId: string
  title: string
  vars: Var[]
}

export type Block = {
  classification?: string
  type: BlockEnum
  title: string
  description?: string
}

export type NodeDefault<T> = {
  defaultValue: Partial<T>
  getAvailablePrevNodes: () => BlockEnum[]
  getAvailableNextNodes: () => BlockEnum[]
}

export type OnSelectBlock = (type: BlockEnum, toolDefaultValue?: ToolDefaultValue) => void

export enum Mode {
  Editing = 'editing',
  Running = 'running',
}
