import type {
  PipelineVariableResponse,
  WorkflowAgentLogResponse,
  WorkflowConversationVariableResponse,
  WorkflowEnvironmentVariableResponse,
  WorkflowFeaturesResponse,
  WorkflowGraphEdgeResponse,
  WorkflowGraphNodeResponse,
  WorkflowGraphResponse,
  WorkflowNodeExecutionMetadataResponse,
  WorkflowResponse,
  WorkflowRunDetailResponse as WorkflowRunDetailContract,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Viewport } from 'reactflow'
import type {
  ConversationVariable,
  Edge,
  EnvironmentVariable,
  EnvironmentVariableValue,
  Node,
  NodeDataType,
} from '../types'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { RAGPipelineVariable } from '@/models/pipeline'
import type {
  AgentLogItem,
  FetchWorkflowDraftResponse,
  NodeTracing,
  WorkflowCanvasGraph,
} from '@/types/workflow'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { PipelineInputVarType } from '@/models/pipeline'
import { TransferMethod, TtsAutoPlay } from '@/types/app'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '../constants'
import { ErrorHandleTypeEnum } from '../nodes/_base/components/error-handle/types'
import { ChatVarType } from '../panel/chat-variable-panel/type'
import { BlockEnum, NOTE_NODE_DATA_TYPE, SupportUploadFileTypes } from '../types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOneOf = <T extends string>(values: Record<string, T>, value: unknown): value is T =>
  typeof value === 'string' && Object.values<string>(values).includes(value)

const NODE_DATA_TYPES = { ...BlockEnum, note: NOTE_NODE_DATA_TYPE } satisfies Record<
  string,
  NodeDataType
>

/**
 * Thrown when a stored graph holds a block this client does not know. Loading it without the
 * node would drop it from the next draft sync, so the editor refuses instead.
 */
export class UnknownWorkflowBlockError extends Error {
  readonly blockType: string

  constructor(blockType: string) {
    super(`Unknown workflow block type "${blockType}"`)
    this.name = 'UnknownWorkflowBlockError'
    this.blockType = blockType
  }
}

const toCanvasNode = (node: WorkflowGraphNodeResponse, index: number): Node => {
  const { type, title, desc } = node.data
  if (!isOneOf(NODE_DATA_TYPES, type)) throw new UnknownWorkflowBlockError(type)

  return {
    ...node,
    type: node.type ?? undefined,
    // Graphs saved without coordinates are laid out left to right, as the editor does on load.
    position: node.position
      ? { x: node.position.x, y: node.position.y }
      : {
          x: START_INITIAL_POSITION.x + index * NODE_WIDTH_X_OFFSET,
          y: START_INITIAL_POSITION.y,
        },
    data: { ...node.data, type, title: title ?? '', desc: desc ?? '' },
  }
}

const toCanvasEdge = (
  edge: WorkflowGraphEdgeResponse,
  nodeTypes: ReadonlyMap<string, NodeDataType>,
): Edge => {
  const storedSourceType = edge.data?.sourceType
  const storedTargetType = edge.data?.targetType
  // Edges saved before endpoint types were recorded take them from the connected nodes.
  const sourceType = isOneOf(NODE_DATA_TYPES, storedSourceType)
    ? storedSourceType
    : nodeTypes.get(edge.source)
  const targetType = isOneOf(NODE_DATA_TYPES, storedTargetType)
    ? storedTargetType
    : nodeTypes.get(edge.target)

  return {
    ...edge,
    id:
      edge.id ??
      `${edge.source}-${edge.sourceHandle ?? 'source'}-${edge.target}-${edge.targetHandle ?? 'target'}`,
    data:
      sourceType !== undefined && targetType !== undefined
        ? { ...edge.data, sourceType, targetType }
        : undefined,
  }
}

const toViewport = (viewport: WorkflowGraphResponse['viewport']): Viewport | undefined =>
  viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : undefined

export const toCanvasGraph = (graph: WorkflowGraphResponse): WorkflowCanvasGraph => {
  const nodes = (graph.nodes ?? []).map(toCanvasNode)
  const nodeTypes = new Map(nodes.map((node) => [node.id, node.data.type]))
  return {
    nodes,
    edges: (graph.edges ?? []).map((edge) => toCanvasEdge(edge, nodeTypes)),
    viewport: toViewport(graph.viewport),
  }
}

const ENVIRONMENT_VARIABLE_TYPES = {
  string: 'string',
  number: 'number',
  secret: 'secret',
  llm: 'llm',
} satisfies Record<string, EnvironmentVariable['value_type']>

const toEnvironmentVariableValue = (
  valueType: EnvironmentVariable['value_type'],
  value: unknown,
): EnvironmentVariableValue | undefined => {
  if (valueType === 'number') return typeof value === 'number' ? value : undefined
  if (valueType !== 'llm') return typeof value === 'string' ? value : undefined
  if (
    !isRecord(value) ||
    typeof value.provider !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mode !== 'string'
  )
    return undefined

  return {
    provider: value.provider,
    name: value.name,
    mode: value.mode,
    completion_params: isRecord(value.completion_params) ? value.completion_params : undefined,
  }
}

// Variables of a type the environment panel cannot edit stay on the server untouched.
export const toEnvironmentVariables = (
  variables: WorkflowEnvironmentVariableResponse[],
): EnvironmentVariable[] =>
  variables.flatMap((variable) => {
    if (!isOneOf(ENVIRONMENT_VARIABLE_TYPES, variable.value_type)) return []
    const value = toEnvironmentVariableValue(variable.value_type, variable.value)
    if (value === undefined) return []
    return [
      {
        id: variable.id,
        name: variable.name,
        description: variable.description,
        value_type: variable.value_type,
        value,
      },
    ]
  })

export const toConversationVariables = (
  variables: WorkflowConversationVariableResponse[],
): ConversationVariable[] =>
  variables.flatMap((variable) =>
    isOneOf(ChatVarType, variable.value_type)
      ? [
          {
            id: variable.id,
            name: variable.name,
            description: variable.description,
            value_type: variable.value_type,
            value: variable.value,
          },
        ]
      : [],
  )

const toDefaultValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined

// Variables of a type the input forms cannot render are left out.
export const toPipelineVariables = (variables: PipelineVariableResponse[]): RAGPipelineVariable[] =>
  variables.flatMap((variable) => {
    if (!isOneOf(PipelineInputVarType, variable.type)) return []
    return [
      {
        belong_to_node_id: variable.belong_to_node_id,
        type: variable.type,
        label: variable.label,
        variable: variable.variable,
        required: variable.required,
        max_length: variable.max_length ?? undefined,
        default_value: toDefaultValue(variable.default_value),
        placeholder: variable.placeholder ?? undefined,
        unit: variable.unit ?? undefined,
        tooltips: variable.tooltips ?? undefined,
        options: variable.options ?? undefined,
        allowed_file_types: variable.allowed_file_types?.filter((type) =>
          isOneOf(SupportUploadFileTypes, type),
        ),
        allowed_file_extensions: variable.allowed_file_extensions ?? undefined,
        allowed_file_upload_methods: variable.allowed_file_upload_methods?.filter((method) =>
          isOneOf(TransferMethod, method),
        ),
      },
    ]
  })

const DEFAULT_TRANSFER_METHODS = [TransferMethod.local_file, TransferMethod.remote_url]
const DEFAULT_FILE_NUMBER_LIMIT = 3

const toTransferMethods = (methods: string[] | null | undefined) =>
  methods?.filter((method) => isOneOf(TransferMethod, method))

const toToggle = (toggle: { enabled?: boolean | null } | null | undefined) => ({
  enabled: !!toggle?.enabled,
})

/** Map stored workflow features to the feature panel state, filling in the panel defaults. */
export const toFeaturesData = (
  features: WorkflowFeaturesResponse,
  fileUploadConfig?: FileUploadConfigResponse,
): FeaturesData => {
  const fileUpload = features.file_upload
  const imageUpload = fileUpload?.image
  const imageTransferMethods = toTransferMethods(imageUpload?.transfer_methods)
  const suggestedQuestions = features.suggested_questions ?? undefined
  const suggested = features.suggested_questions_after_answer
  const textToSpeech = features.text_to_speech
  const moderation = features.sensitive_word_avoidance

  return {
    file: {
      image: {
        enabled: !!imageUpload?.enabled,
        number_limits: imageUpload?.number_limits || DEFAULT_FILE_NUMBER_LIMIT,
        transfer_methods: imageTransferMethods?.length
          ? imageTransferMethods
          : DEFAULT_TRANSFER_METHODS,
      },
      enabled: !!(fileUpload?.enabled || imageUpload?.enabled),
      allowed_file_types: fileUpload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions:
        fileUpload?.allowed_file_extensions ||
        FILE_EXTS[SupportUploadFileTypes.image]!.map((ext) => `.${ext}`),
      allowed_file_upload_methods:
        toTransferMethods(fileUpload?.allowed_file_upload_methods) ||
        imageTransferMethods ||
        DEFAULT_TRANSFER_METHODS,
      number_limits:
        fileUpload?.number_limits || imageUpload?.number_limits || DEFAULT_FILE_NUMBER_LIMIT,
      fileUploadConfig,
    },
    // Suggested questions alone keep the opening enabled, or the next draft sync would clear them.
    opening: {
      enabled: !!features.opening_statement || !!suggestedQuestions?.length,
      opening_statement: features.opening_statement ?? undefined,
      suggested_questions: suggestedQuestions,
    },
    suggested: {
      enabled: !!suggested?.enabled,
      model: suggested?.model ?? undefined,
      prompt: suggested?.prompt ?? undefined,
    },
    speech2text: toToggle(features.speech_to_text),
    text2speech: {
      enabled: !!textToSpeech?.enabled,
      language: textToSpeech?.language ?? undefined,
      voice: textToSpeech?.voice ?? undefined,
      autoPlay: isOneOf(TtsAutoPlay, textToSpeech?.autoPlay) ? textToSpeech.autoPlay : undefined,
    },
    citation: toToggle(features.retriever_resource),
    moderation: {
      enabled: !!moderation?.enabled,
      type: moderation?.type ?? undefined,
      config: moderation?.config ?? undefined,
    },
  }
}

export const toWorkflowDraft = (workflow: WorkflowResponse): FetchWorkflowDraftResponse => ({
  ...workflow,
  graph: toCanvasGraph(workflow.graph),
  environment_variables: toEnvironmentVariables(workflow.environment_variables),
  conversation_variables: toConversationVariables(workflow.conversation_variables),
  rag_pipeline_variables: toPipelineVariables(workflow.rag_pipeline_variables),
})

export const toWorkflowRunDetail = (
  detail: WorkflowRunDetailContract,
): WorkflowRunDetailResponse => ({
  ...detail,
  graph: toCanvasGraph(detail.graph),
})

const toAgentLogItem = (log: WorkflowAgentLogResponse): AgentLogItem => ({
  node_execution_id: log.node_execution_id ?? '',
  message_id: log.message_id ?? '',
  node_id: log.node_id ?? '',
  parent_id: log.parent_id ?? undefined,
  label: log.label ?? '',
  data: log.data ?? {},
  error: log.error ?? undefined,
  status: log.status ?? '',
  metadata: log.metadata
    ? {
        elapsed_time: log.metadata.elapsed_time ?? undefined,
        provider: log.metadata.provider ?? undefined,
        icon: log.metadata.icon ?? undefined,
      }
    : undefined,
})

const toExecutionMetadata = (
  metadata: WorkflowNodeExecutionMetadataResponse,
): NonNullable<NodeTracing['execution_metadata']> => ({
  total_tokens: metadata.total_tokens ?? 0,
  total_price: metadata.total_price ?? 0,
  currency: metadata.currency ?? '',
  iteration_id: metadata.iteration_id ?? undefined,
  iteration_index: metadata.iteration_index ?? undefined,
  loop_id: metadata.loop_id ?? undefined,
  loop_index: metadata.loop_index ?? undefined,
  parallel_id: metadata.parallel_id ?? undefined,
  parallel_start_node_id: metadata.parallel_start_node_id ?? undefined,
  parent_parallel_id: metadata.parent_parallel_id ?? undefined,
  parent_parallel_start_node_id: metadata.parent_parallel_start_node_id ?? undefined,
  parallel_mode_run_id: metadata.parallel_mode_run_id ?? undefined,
  iteration_duration_map: metadata.iteration_duration_map ?? undefined,
  loop_duration_map: metadata.loop_duration_map ?? undefined,
  error_strategy: isOneOf(ErrorHandleTypeEnum, metadata.error_strategy)
    ? metadata.error_strategy
    : undefined,
  // Agent V2 nodes store backend run metadata here instead of a log list; the trace has no tree for it.
  agent_log: Array.isArray(metadata.agent_log) ? metadata.agent_log.map(toAgentLogItem) : undefined,
  tool_info: metadata.tool_info
    ? {
        agent_strategy: metadata.tool_info.agent_strategy ?? undefined,
        icon: metadata.tool_info.icon ?? undefined,
      }
    : undefined,
  loop_variable_map: metadata.loop_variable_map ?? undefined,
})

// The trace is read-only, so executions of blocks this client does not know are skipped.
export const toNodeTracing = (execution: WorkflowRunNodeExecutionResponse): NodeTracing[] => {
  const nodeType = execution.node_type
  if (!isOneOf(BlockEnum, nodeType)) return []

  return [
    {
      id: execution.id,
      index: execution.index ?? 0,
      predecessor_node_id: execution.predecessor_node_id ?? '',
      node_id: execution.node_id ?? '',
      node_type: nodeType,
      title: execution.title ?? '',
      inputs: execution.inputs,
      inputs_truncated: execution.inputs_truncated ?? false,
      process_data: execution.process_data,
      process_data_truncated: execution.process_data_truncated ?? false,
      outputs: isRecord(execution.outputs) ? execution.outputs : undefined,
      outputs_truncated: execution.outputs_truncated ?? false,
      status: execution.status ?? '',
      error: execution.error ?? undefined,
      elapsed_time: execution.elapsed_time ?? 0,
      execution_metadata: execution.execution_metadata
        ? toExecutionMetadata(execution.execution_metadata)
        : undefined,
      created_at: execution.created_at ?? 0,
      created_by: execution.created_by_account ?? undefined,
      finished_at: execution.finished_at ?? 0,
      extras: execution.extras,
      retry_index: execution.retry_index ?? undefined,
    },
  ]
}
