/* eslint-disable ts/no-redeclare -- const objects + matching type aliases replace enums under erasableSyntaxOnly */
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
import type {
  FileResponse,
  HumanInputFilledFormData,
  HumanInputFormData,
  NodeTracing,
  PanelProps,
} from '@/types/workflow'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const BlockEnum = {
  Start: 'start',
  End: 'end',
  Answer: 'answer',
  LLM: 'llm',
  KnowledgeRetrieval: 'knowledge-retrieval',
  QuestionClassifier: 'question-classifier',
  IfElse: 'if-else',
  Code: 'code',
  TemplateTransform: 'template-transform',
  HttpRequest: 'http-request',
  VariableAssigner: 'variable-assigner',
  VariableAggregator: 'variable-aggregator',
  Tool: 'tool',
  ParameterExtractor: 'parameter-extractor',
  Iteration: 'iteration',
  DocExtractor: 'document-extractor',
  ListFilter: 'list-operator',
  IterationStart: 'iteration-start',
  Assigner: 'assigner', // is now named as VariableAssigner
  Agent: 'agent',
  Loop: 'loop',
  LoopStart: 'loop-start',
  LoopEnd: 'loop-end',
  HumanInput: 'human-input',
  DataSource: 'datasource',
  DataSourceEmpty: 'datasource-empty',
  KnowledgeBase: 'knowledge-index',
  TriggerSchedule: 'trigger-schedule',
  TriggerWebhook: 'trigger-webhook',
  TriggerPlugin: 'trigger-plugin',
  Command: 'command',
  FileUpload: 'file-upload',
} as const
export type BlockEnum = typeof BlockEnum[keyof typeof BlockEnum]

export const ControlMode = {
  Pointer: 'pointer',
  Hand: 'hand',
  Comment: 'comment',
} as const
export type ControlMode = typeof ControlMode[keyof typeof ControlMode]

export const ErrorHandleMode = {
  Terminated: 'terminated',
  ContinueOnError: 'continue-on-error',
  RemoveAbnormalOutput: 'remove-abnormal-output',
} as const
export type ErrorHandleMode = typeof ErrorHandleMode[keyof typeof ErrorHandleMode]
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
  parent_node_id?: string
  _isEntering?: boolean
  _showAddVariablePopup?: boolean
  _holdAddVariablePopup?: boolean
  _iterationLength?: number
  _iterationIndex?: number
  _waitingRun?: boolean
  _retryIndex?: number
  _dataSourceStartToAdd?: boolean
  _isTempNode?: boolean
  _subGraphEntry?: boolean
  _iconTypeOverride?: BlockEnum
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
  value: JsonValue
  value_type: 'string' | 'number' | 'secret'
  description: string
}

export type ConversationVariable = {
  id: string
  name: string
  value_type: ChatVarType
  value: JsonValue
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

export const InputVarType = {
  textInput: 'text-input',
  paragraph: 'paragraph',
  select: 'select',
  number: 'number',
  url: 'url',
  files: 'files',
  json: 'json', // obj, array
  jsonObject: 'json_object', // only object support define json schema
  contexts: 'contexts', // knowledge retrieval
  iterator: 'iterator', // iteration input
  singleFile: 'file',
  multiFiles: 'file-list',
  loop: 'loop', // loop input
  checkbox: 'checkbox',
} as const
export type InputVarType = typeof InputVarType[keyof typeof InputVarType]

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
  json_schema?: string | Record<string, unknown> // for jsonObject type
} & Partial<UploadFileSetting>

export type ModelConfig = {
  provider: string
  name: string
  mode: string
  completion_params: Record<string, unknown>
}

export const PromptRole = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
} as const
export type PromptRole = typeof PromptRole[keyof typeof PromptRole]

export const EditionType = {
  basic: 'basic',
  jinja2: 'jinja2',
} as const
export type EditionType = typeof EditionType[keyof typeof EditionType]

export type PromptItem = {
  id?: string
  role?: PromptRole
  text: string
  edition_type?: EditionType
  jinja2_text?: string
  skill?: boolean
  metadata?: Record<string, unknown>
}

export type PromptMessageContext = {
  id?: string
  $context: ValueSelector
  skill?: boolean
  metadata?: Record<string, unknown>
}

export type PromptTemplateItem = PromptItem | PromptMessageContext

export const isPromptMessageContext = (item: PromptTemplateItem): item is PromptMessageContext => {
  return '$context' in item
}

export const MemoryRole = {
  user: 'user',
  assistant: 'assistant',
} as const
export type MemoryRole = typeof MemoryRole[keyof typeof MemoryRole]

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

export const VarType = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  secret: 'secret',
  boolean: 'boolean',
  object: 'object',
  file: 'file',
  array: 'array',
  arrayString: 'array[string]',
  arrayNumber: 'array[number]',
  arrayObject: 'array[object]',
  arrayBoolean: 'array[boolean]',
  arrayFile: 'array[file]',
  arrayMessage: 'array[message]',
  any: 'any',
  arrayAny: 'array[any]',
} as const
export type VarType = typeof VarType[keyof typeof VarType]

export const ValueType = {
  variable: 'variable',
  constant: 'constant',
} as const
export type ValueType = typeof ValueType[keyof typeof ValueType]

export type VarSchemaContainer = {
  schema?: StructuredOutput['schema'] | Record<string, unknown> | string
}

export type VarChildren = Var[] | StructuredOutput | VarSchemaContainer

export type Var = {
  variable: string
  type: VarType
  children?: VarChildren // if type is obj, has the children struct
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
  nodeType?: BlockEnum
}

// allow node default validators with narrower payload types to be stored in shared collections.
type CheckValidFn<T> = {
  // eslint-disable-next-line ts/no-explicit-any -- bivariant node validators; implementations use narrower `t` / moreData shapes
  bivarianceHack: (payload: T, t: any, moreDataForCheckValid?: any) => { isValid: boolean, errorMessage?: string }
}['bivarianceHack']

// allow node output var generators with narrower payload types to be stored in shared collections.
type GetOutputVarsFn<T> = {
  bivarianceHack: (
    payload: T,
    allPluginInfoList: Record<string, ToolWithProvider[]>,
    ragVariables?: Var[],
    utils?: {
      schemaTypeDefinitions?: SchemaTypeDefinition[]
    },
  ) => Var[]
}['bivarianceHack']

export type NodeDefaultBase = {
  metaData: {
    classification: BlockClassificationEnum
    sort: number
    type: BlockEnum
    iconType?: BlockEnum
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
  defaultValue: Partial<CommonNodeType>
  defaultRunInputData?: Record<string, unknown>
  checkValid: CheckValidFn<CommonNodeType>
  getOutputVars?: GetOutputVarsFn<CommonNodeType>
}

export type NodeDefault<T extends CommonNodeType = CommonNodeType> = Omit<NodeDefaultBase, 'defaultValue' | 'checkValid' | 'getOutputVars'> & {
  defaultValue: Partial<T>
  checkValid: CheckValidFn<T>
  getOutputVars?: GetOutputVarsFn<T>
}

export type OnSelectBlock = (type: BlockEnum, pluginDefaultValue?: PluginDefaultValue) => void

export const WorkflowRunningStatus = {
  Waiting: 'waiting',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Stopped: 'stopped',
  Paused: 'paused',
} as const
export type WorkflowRunningStatus = typeof WorkflowRunningStatus[keyof typeof WorkflowRunningStatus]

export const WorkflowVersion = {
  Draft: 'draft',
  Latest: 'latest',
} as const
export type WorkflowVersion = typeof WorkflowVersion[keyof typeof WorkflowVersion]

export const NodeRunningStatus = {
  NotStart: 'not-start',
  Waiting: 'waiting',
  Listening: 'listening',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Exception: 'exception',
  Retry: 'retry',
  Stopped: 'stopped',
  Paused: 'paused',
} as const
export type NodeRunningStatus = typeof NodeRunningStatus[keyof typeof NodeRunningStatus]

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
    created_by?: {
      id: string
      name: string
      email: string
    }
    finished_at?: number
    steps?: number
    showSteps?: boolean
    total_steps?: number
    files?: FileResponse[]
    exceptions_count?: number
  }
  tracing?: NodeTracing[]
  humanInputFormDataList?: HumanInputFormData[]
  humanInputFilledFormDataList?: HumanInputFilledFormData[]
}

export type HistoryWorkflowData = {
  id: string
  status: string
  conversation_id?: string
  finished_at?: number
}

export const ChangeType = {
  changeVarName: 'changeVarName',
  remove: 'remove',
} as const
export type ChangeType = typeof ChangeType[keyof typeof ChangeType]

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

export const SupportUploadFileTypes = {
  image: 'image',
  document: 'document',
  audio: 'audio',
  video: 'video',
  custom: 'custom',
} as const
export type SupportUploadFileTypes = typeof SupportUploadFileTypes[keyof typeof SupportUploadFileTypes]

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

export const WorkflowVersionFilterOptions = {
  all: 'all',
  onlyYours: 'onlyYours',
} as const
export type WorkflowVersionFilterOptions = typeof WorkflowVersionFilterOptions[keyof typeof WorkflowVersionFilterOptions]

export const VersionHistoryContextMenuOptions = {
  restore: 'restore',
  edit: 'edit',
  delete: 'delete',
  exportDSL: 'exportDSL',
  copyId: 'copyId',
} as const
export type VersionHistoryContextMenuOptions = typeof VersionHistoryContextMenuOptions[keyof typeof VersionHistoryContextMenuOptions]

export type ChildNodeTypeCount = {
  [key: string]: number
}

export const TRIGGER_NODE_TYPES: BlockEnum[] = [
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
]

export type TriggerNodeType = typeof BlockEnum.TriggerSchedule | typeof BlockEnum.TriggerWebhook | typeof BlockEnum.TriggerPlugin

export function isTriggerNode(nodeType: BlockEnum): boolean {
  return TRIGGER_NODE_TYPES.includes(nodeType)
}

export type Block = {
  classification?: string
  type: BlockEnum
  title: string
  description?: string
}

export const ViewType = {
  graph: 'graph',
  files: 'files',
} as const
export type ViewType = typeof ViewType[keyof typeof ViewType]
