import type {
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
  Viewport,
} from 'reactflow'
import type { TransferMethod } from '@/types/app'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import type { NodeTracing } from '@/types/workflow'
import type { Collection, Tool } from '@/app/components/tools/types'

export enum BlockEnum {
  Start = 'start',
  End = 'end',
  Answer = 'answer',
  LLM = 'llm',
  KnowledgeRetrieval = 'knowledge-retrieval',
  QuestionClassifier = 'question-classifier',
  IfElse = 'if-else',
  Code = 'code',
  TemplateTransform = 'template-transform',
  HttpRequest = 'http-request',
  VariableAssigner = 'variable-assigner',
  VariableAggregator = 'variable-aggregator',
  Tool = 'tool',
  ParameterExtractor = 'parameter-extractor',
  Iteration = 'iteration',
}

export type Branch = {
  id: string
  name: string
}

export type CommonNodeType<T = {}> = {
  _connectedSourceHandleIds?: string[]
  _connectedTargetHandleIds?: string[]
  _targetBranches?: Branch[]
  _isSingleRun?: boolean
  _runningStatus?: NodeRunningStatus
  _singleRunningStatus?: NodeRunningStatus
  _isCandidate?: boolean
  _isBundled?: boolean
  _children?: string[]
  _isEntering?: boolean
  _showAddVariablePopup?: boolean
  _holdAddVariablePopup?: boolean
  _iterationLength?: number
  _iterationIndex?: number
  isIterationStart?: boolean
  isInIteration?: boolean
  iteration_id?: string
  selected?: boolean
  title: string
  desc: string
  type: BlockEnum
  width?: number
  height?: number
} & T & Partial<Pick<ToolDefaultValue, 'provider_id' | 'provider_type' | 'provider_name' | 'tool_name'>>

export type CommonEdgeType = {
  _hovering?: boolean
  _connectedNodeIsHovering?: boolean
  _connectedNodeIsSelected?: boolean
  _runned?: boolean
  _isBundled?: boolean
  isInIteration?: boolean
  iteration_id?: string
  sourceType: BlockEnum
  targetType: BlockEnum
}

export type Node<T = {}> = ReactFlowNode<CommonNodeType<T>>
export type SelectedNode = Pick<Node, 'id' | 'data'>
export type NodeProps<T = unknown> = { id: string; data: CommonNodeType<T> }
export type NodePanelProps<T> = {
  id: string
  data: CommonNodeType<T>
}
export type Edge = ReactFlowEdge<CommonEdgeType>

export type WorkflowDataUpdator = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

export type ValueSelector = string[] // [nodeId, key | obj key path]

export type Variable = {
  variable: string
  label?: string | {
    nodeType: BlockEnum
    nodeName: string
    variable: string
  }
  value_selector: ValueSelector
  variable_type?: VarKindType
  value?: string
  options?: string[]
  required?: boolean
  isParagraph?: boolean
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
  json = 'json', // obj, array
  contexts = 'contexts', // knowledge retrieval
  iterator = 'iterator', // iteration input
}

export type InputVar = {
  type: InputVarType
  label: string | {
    nodeType: BlockEnum
    nodeName: string
    variable: string
  }
  variable: string
  max_length?: number
  default?: string
  required: boolean
  hint?: string
  options?: string[]
  value_selector?: ValueSelector
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

export enum EditionType {
  basic = 'basic',
  jinja2 = 'jinja2',
}

export type PromptItem = {
  id?: string
  role?: PromptRole
  text: string
  edition_type?: EditionType
  jinja2_text?: string
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
  query_prompt_template: string
}

export enum VarType {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',
  array = 'array',
  arrayString = 'array[string]',
  arrayNumber = 'array[number]',
  arrayObject = 'array[object]',
  arrayFile = 'array[file]',
  any = 'any',
}

export type Var = {
  variable: string
  type: VarType
  children?: Var[] // if type is obj, has the children struct
  isParagraph?: boolean
  isSelect?: boolean
  options?: string[]
  required?: boolean
}

export type NodeOutPutVar = {
  nodeId: string
  title: string
  vars: Var[]
  isStartNode?: boolean
}

export type Block = {
  classification?: string
  type: BlockEnum
  title: string
  description?: string
}

export type NodeDefault<T> = {
  defaultValue: Partial<T>
  getAvailablePrevNodes: (isChatMode: boolean) => BlockEnum[]
  getAvailableNextNodes: (isChatMode: boolean) => BlockEnum[]
  checkValid: (payload: T, t: any, moreDataForCheckValid?: any) => { isValid: boolean; errorMessage?: string }
}

export type OnSelectBlock = (type: BlockEnum, toolDefaultValue?: ToolDefaultValue) => void

export enum WorkflowRunningStatus {
  Waiting = 'waiting',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Stopped = 'stopped',
}

export enum NodeRunningStatus {
  NotStart = 'not-start',
  Waiting = 'waiting',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
}

export type OnNodeAdd = (
  newNodePayload: {
    nodeType: BlockEnum
    sourceHandle?: string
    targetHandle?: string
    toolDefaultValue?: ToolDefaultValue
  },
  oldNodesPayload: {
    prevNodeId?: string
    prevNodeSourceHandle?: string
    nextNodeId?: string
    nextNodeTargetHandle?: string
  }
) => void

export type CheckValidRes = {
  isValid: boolean
  errorMessage?: string
}

export type RunFile = {
  type: string
  transfer_method: TransferMethod[]
  url?: string
  upload_file_id?: string
}

export type WorkflowRunningData = {
  task_id?: string
  message_id?: string
  conversation_id?: string
  result: {
    sequence_number?: number
    workflow_id?: string
    inputs?: string
    process_data?: string
    outputs?: string
    status: string
    error?: string
    elapsed_time?: number
    total_tokens?: number
    created_at?: number
    created_by?: string
    finished_at?: number
    steps?: number
    showSteps?: boolean
    total_steps?: number
  }
  tracing?: NodeTracing[]
}

export type HistoryWorkflowData = {
  id: string
  sequence_number: number
  status: string
  conversation_id?: string
}

export enum ChangeType {
  changeVarName = 'changeVarName',
  remove = 'remove',
}

export type MoreInfo = {
  type: ChangeType
  payload?: {
    beforeKey: string
    afterKey?: string
  }
}

export type ToolWithProvider = Collection & {
  tools: Tool[]
}
