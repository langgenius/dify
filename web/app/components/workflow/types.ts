import type {
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
  Viewport,
  XYPosition,
} from 'reactflow'
import type { Plugin, PluginMeta } from '@/app/components/plugins/types'
import type { Collection, Tool } from '@/app/components/tools/types'
import type { BlockClassificationEnum, PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import type {
  DefaultValueForm,
  ErrorHandleTypeEnum,
} from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import type { WorkflowRetryConfig } from '@/app/components/workflow/nodes/_base/components/retry/types'
import type { StructuredOutput } from '@/app/components/workflow/nodes/llm/types'
import type { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import type { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import type { SchemaTypeDefinition } from '@/service/use-common'
import type { Resolution, TransferMethod } from '@/types/app'
import type { FileResponse, NodeTracing, PanelProps } from '@/types/workflow'

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
  DocExtractor = 'document-extractor',
  ListFilter = 'list-operator',
  IterationStart = 'iteration-start',
  Assigner = 'assigner', // is now named as VariableAssigner
  Agent = 'agent',
  Loop = 'loop',
  LoopStart = 'loop-start',
  LoopEnd = 'loop-end',
  DataSource = 'datasource',
  DataSourceEmpty = 'datasource-empty',
  KnowledgeBase = 'knowledge-index',
  TriggerSchedule = 'trigger-schedule',
  TriggerWebhook = 'trigger-webhook',
  TriggerPlugin = 'trigger-plugin',
}

export enum ControlMode {
  Pointer = 'pointer',
  Hand = 'hand',
}
export enum ErrorHandleMode {
  Terminated = 'terminated',
  ContinueOnError = 'continue-on-error',
  RemoveAbnormalOutput = 'remove-abnormal-output',
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
  _runningBranchId?: string
  _singleRunningStatus?: NodeRunningStatus
  _isCandidate?: boolean
  _isBundled?: boolean
  _children?: { nodeId: string, nodeType: BlockEnum }[]
  _isEntering?: boolean
  _showAddVariablePopup?: boolean
  _holdAddVariablePopup?: boolean
  _iterationLength?: number
  _iterationIndex?: number
  _waitingRun?: boolean
  _retryIndex?: number
  _dataSourceStartToAdd?: boolean
  _isTempNode?: boolean
  isInIteration?: boolean
  iteration_id?: string
  selected?: boolean
  title: string
  desc: string
  type: BlockEnum
  width?: number
  height?: number
  position?: XYPosition
  _loopLength?: number
  _loopIndex?: number
  isInLoop?: boolean
  loop_id?: string
  error_strategy?: ErrorHandleTypeEnum
  retry_config?: WorkflowRetryConfig
  default_value?: DefaultValueForm[]
  credential_id?: string
  subscription_id?: string
  provider_id?: string
  _dimmed?: boolean
  _pluginInstallLocked?: boolean
} & T & Partial<PluginDefaultValue>

export type CommonEdgeType = {
  _hovering?: boolean
  _connectedNodeIsHovering?: boolean
  _connectedNodeIsSelected?: boolean
  _isBundled?: boolean
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _waitingRun?: boolean
  isInIteration?: boolean
  iteration_id?: string
  isInLoop?: boolean
  loop_id?: string
  sourceType: BlockEnum
  targetType: BlockEnum
  _isTemp?: boolean
}

export type Node<T = {}> = ReactFlowNode<CommonNodeType<T>>
export type SelectedNode = Pick<Node, 'id' | 'data'>
export type NodeProps<T = unknown> = { id: string, data: CommonNodeType<T> }
export type NodePanelProps<T> = {
  id: string
  data: CommonNodeType<T>
  panelProps: PanelProps
}
export type Edge = ReactFlowEdge<CommonEdgeType>

export type WorkflowDataUpdater = {
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
  value_type?: VarType
  variable_type?: VarKindType
  value?: string
  options?: string[]
  required?: boolean
  isParagraph?: boolean
}

export type EnvironmentVariable = {
  id: string
  name: string
  value: any
  value_type: 'string' | 'number' | 'secret'
  description: string
}

export type ConversationVariable = {
  id: string
  name: string
  value_type: ChatVarType
  value: any
  description: string
}

export type GlobalVariable = {
  name: string
  value_type: 'string' | 'number' | 'integer'
  description: string
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
  checkbox = 'checkbox',
  url = 'url',
  files = 'files',
  json = 'json', // obj, array
  jsonObject = 'json_object', // only object support define json schema
  contexts = 'contexts', // knowledge retrieval
  iterator = 'iterator', // iteration input
  singleFile = 'file',
  multiFiles = 'file-list',
  loop = 'loop', // loop input
}

export type InputVar = {
  type: InputVarType
  label: string | {
    nodeType: BlockEnum
    nodeName: string
    variable: string
    isChatVar?: boolean
  }
  variable: string
  max_length?: number
  default?: string | number
  required: boolean
  hint?: string
  options?: string[]
  value_selector?: ValueSelector
  placeholder?: string
  unit?: string
  getVarValueFromDependent?: boolean
  hide?: boolean
  isFileItem?: boolean
  json_schema?: string | Record<string, any> // for jsonObject type
} & Partial<UploadFileSetting>

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
  integer = 'integer',
  secret = 'secret',
  boolean = 'boolean',
  object = 'object',
  file = 'file',
  array = 'array',
  arrayString = 'array[string]',
  arrayNumber = 'array[number]',
  arrayObject = 'array[object]',
  arrayBoolean = 'array[boolean]',
  arrayFile = 'array[file]',
  any = 'any',
  arrayAny = 'array[any]',
}

export enum ValueType {
  variable = 'variable',
  constant = 'constant',
}

export type Var = {
  variable: string
  type: VarType
  children?: Var[] | StructuredOutput // if type is obj, has the children struct
  isParagraph?: boolean
  isSelect?: boolean
  options?: string[]
  required?: boolean
  des?: string
  isException?: boolean
  isLoopVariable?: boolean
  nodeId?: string
  isRagVariable?: boolean
  schemaType?: string
}

export type NodeOutPutVar = {
  nodeId: string
  title: string
  vars: Var[]
  isStartNode?: boolean
  isLoop?: boolean
  isFlat?: boolean
}

export type NodeDefault<T = {}> = {
  metaData: {
    classification: BlockClassificationEnum
    sort: number
    type: BlockEnum
    title: string
    author: string
    description?: string
    helpLinkUri?: string
    isRequired?: boolean
    isUndeletable?: boolean
    isStart?: boolean
    isSingleton?: boolean
    isTypeFixed?: boolean
  }
  defaultValue: Partial<T>
  defaultRunInputData?: Record<string, any>
  checkValid: (payload: T, t: any, moreDataForCheckValid?: any) => { isValid: boolean, errorMessage?: string }
  getOutputVars?: (payload: T, allPluginInfoList: Record<string, ToolWithProvider[]>, ragVariables?: Var[], utils?: {
    schemaTypeDefinitions?: SchemaTypeDefinition[]
  }) => Var[]
}

export type OnSelectBlock = (type: BlockEnum, pluginDefaultValue?: PluginDefaultValue) => void

export enum WorkflowRunningStatus {
  Waiting = 'waiting',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Stopped = 'stopped',
}

export enum WorkflowVersion {
  Draft = 'draft',
  Latest = 'latest',
}

export enum NodeRunningStatus {
  NotStart = 'not-start',
  Waiting = 'waiting',
  Listening = 'listening',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Exception = 'exception',
  Retry = 'retry',
  Stopped = 'stopped',
}

export type OnNodeAdd = (
  newNodePayload: {
    nodeType: BlockEnum
    sourceHandle?: string
    targetHandle?: string
    pluginDefaultValue?: PluginDefaultValue
  },
  oldNodesPayload: {
    prevNodeId?: string
    prevNodeSourceHandle?: string
    nextNodeId?: string
    nextNodeTargetHandle?: string
  },
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
  related_id?: string
}

export type WorkflowRunningData = {
  task_id?: string
  message_id?: string
  conversation_id?: string
  result: {
    workflow_id?: string
    inputs?: string
    inputs_truncated: boolean
    process_data?: string
    process_data_truncated: boolean
    outputs?: string
    outputs_truncated: boolean
    outputs_full_content?: {
      download_url: string
    }
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
    files?: FileResponse[]
    exceptions_count?: number
  }
  tracing?: NodeTracing[]
}

export type HistoryWorkflowData = {
  id: string
  status: string
  conversation_id?: string
  finished_at?: number
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
  meta: PluginMeta
  plugin_unique_identifier?: string
}

export type RAGRecommendedPlugins = {
  installed_recommended_plugins: ToolWithProvider[]
  uninstalled_recommended_plugins: Plugin[]
}

export enum SupportUploadFileTypes {
  image = 'image',
  document = 'document',
  audio = 'audio',
  video = 'video',
  custom = 'custom',
}

export type UploadFileSetting = {
  allowed_file_upload_methods: TransferMethod[]
  allowed_upload_methods?: TransferMethod[]
  allowed_file_types: SupportUploadFileTypes[]
  allowed_file_extensions?: string[]
  max_length: number
  number_limits?: number
}

export type VisionSetting = {
  variable_selector: ValueSelector
  detail: Resolution
}

export enum WorkflowVersionFilterOptions {
  all = 'all',
  onlyYours = 'onlyYours',
}

export enum VersionHistoryContextMenuOptions {
  restore = 'restore',
  edit = 'edit',
  delete = 'delete',
  exportDSL = 'exportDSL',
  copyId = 'copyId',
}

export type ChildNodeTypeCount = {
  [key: string]: number
}

export const TRIGGER_NODE_TYPES = [
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
] as const

// Type-safe trigger node type extracted from TRIGGER_NODE_TYPES array
export type TriggerNodeType = typeof TRIGGER_NODE_TYPES[number]

export function isTriggerNode(nodeType: BlockEnum): boolean {
  return TRIGGER_NODE_TYPES.includes(nodeType as any)
}

export type Block = {
  classification?: string
  type: BlockEnum
  title: string
  description?: string
}
