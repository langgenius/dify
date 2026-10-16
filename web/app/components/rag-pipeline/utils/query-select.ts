import type { DocumentPipelineExecutionLogResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type {
  PipelineGenerateResponse,
  PipelineTemplateDetailResponse,
  PipelineTemplateListResponse as PipelineTemplateListContract,
  PostRagPipelinesByPipelineIdWorkflowsPublishedDatasourceNodesByNodeIdPreviewResponse,
  RagPipelineImportCheckDependenciesResponse,
  RagPipelinePublishedRunResponse,
  RagPipelineStepParametersResponse,
  WorkflowAppBlockingResponse,
  WorkflowResponse,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/rag/types.gen'
import type { Viewport } from 'reactflow'
import type { Dependency } from '@/app/components/plugins/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { FileIndexingEstimateResponse, IconInfo } from '@/models/datasets'
import type {
  PipelineExecutionLogResponse,
  PipelineTemplate,
  PipelineTemplateByIdResponse,
} from '@/models/pipeline'
import type { AppIconType } from '@/types/app'
import type { NodeRunResult } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { toPipelineVariables } from '@/app/components/workflow/utils/workflow-response'
import { ChunkingMode } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

const getNumber = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

const isOneOf = <T extends string>(values: Record<string, T>, value: unknown): value is T =>
  typeof value === 'string' && Object.values<string>(values).includes(value)

const APP_ICON_TYPES = { image: 'image', emoji: 'emoji', link: 'link' } satisfies Record<
  AppIconType,
  AppIconType
>

const toIconInfo = (icon: Record<string, unknown>): IconInfo => {
  const iconType = icon.icon_type
  return {
    icon: getString(icon, 'icon') ?? '',
    icon_type: isOneOf(APP_ICON_TYPES, iconType) ? iconType : 'emoji',
    icon_background: getString(icon, 'icon_background'),
    icon_url: getString(icon, 'icon_url'),
  }
}

// Templates exported before a chunk structure was recorded default to general text chunks.
const toChunkingMode = (chunkStructure: string) =>
  isOneOf(ChunkingMode, chunkStructure) ? chunkStructure : ChunkingMode.text

// The workflow graph is stored as free-form JSON; keep the nodes and edges React Flow can place.
const isGraphNode = (value: unknown): value is Node =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  isRecord(value.data) &&
  isRecord(value.position)

const isGraphEdge = (value: unknown): value is Edge =>
  isRecord(value) && typeof value.source === 'string' && typeof value.target === 'string'

const toGraphNodes = (graph: Record<string, unknown>) =>
  Array.isArray(graph.nodes) ? graph.nodes.filter(isGraphNode) : []

const toGraphEdges = (graph: Record<string, unknown>) =>
  Array.isArray(graph.edges) ? graph.edges.filter(isGraphEdge) : []

const toViewport = (graph: Record<string, unknown>): Viewport => {
  const viewport = isRecord(graph.viewport) ? graph.viewport : {}
  return {
    x: getNumber(viewport, 'x') ?? 0,
    y: getNumber(viewport, 'y') ?? 0,
    zoom: getNumber(viewport, 'zoom') ?? 1,
  }
}

export const selectPipelineTemplateList = (data: PipelineTemplateListContract) => ({
  pipeline_templates: data.pipeline_templates.map((template): PipelineTemplate => ({
    id: template.id,
    name: template.name,
    description: template.description,
    position: template.position,
    icon: toIconInfo(template.icon),
    chunk_structure: toChunkingMode(template.chunk_structure),
  })),
})

export const selectPipelineTemplate = (
  template: PipelineTemplateDetailResponse,
): PipelineTemplateByIdResponse => ({
  id: template.id,
  name: template.name,
  description: template.description,
  export_data: template.export_data,
  created_by: template.created_by ?? '',
  icon_info: toIconInfo(template.icon_info),
  chunk_structure: toChunkingMode(template.chunk_structure),
  graph: {
    nodes: toGraphNodes(template.graph),
    edges: toGraphEdges(template.graph),
    viewport: toViewport(template.graph),
  },
})

export const selectPublishedPipelineNodes = (workflow: WorkflowResponse) =>
  toGraphNodes(workflow.graph)

// Variables of a type the input forms cannot render are left out.
export const selectPipelineStepParameters = (data: RagPipelineStepParametersResponse) => ({
  variables: toPipelineVariables(data.variables),
})

export const selectPipelineExecutionLog = (
  log: DocumentPipelineExecutionLogResponse,
): PipelineExecutionLogResponse => ({
  datasource_info: isRecord(log.datasource_info) ? log.datasource_info : {},
  input_data: isRecord(log.input_data) ? log.input_data : {},
  datasource_node_id: log.datasource_node_id ?? '',
  datasource_type: isOneOf(DatasourceType, log.datasource_type)
    ? log.datasource_type
    : DatasourceType.localFile,
})

export const selectPipelineDependencies = (
  data: RagPipelineImportCheckDependenciesResponse,
): Dependency[] =>
  (data.leaked_dependencies ?? []).map((dependency) => ({
    ...dependency,
    // The dependency store represents an absent version with undefined.
    value: { ...dependency.value, version: dependency.value.version ?? undefined },
  }))

export const isPipelineProcessingRun = (
  response: RagPipelinePublishedRunResponse,
): response is PipelineGenerateResponse => 'batch' in response

// Preview runs return the indexing estimate as the workflow outputs.
const isFileIndexingEstimate = (value: unknown): value is FileIndexingEstimateResponse =>
  isRecord(value) && typeof value.total_segments === 'number' && Array.isArray(value.preview)

export const selectPreviewRunEstimate = (response: WorkflowAppBlockingResponse) =>
  isFileIndexingEstimate(response.data.outputs) ? response.data.outputs : undefined

export const selectOnlineDocumentPreview = (
  data: PostRagPipelinesByPipelineIdWorkflowsPublishedDatasourceNodesByNodeIdPreviewResponse,
) => ({ content: getString(data, 'content') ?? '' })

const BLOCKS: Record<string, BlockEnum> = BlockEnum

export const selectDatasourceSingleRun = (
  execution: WorkflowRunNodeExecutionResponse,
): NodeRunResult => {
  const metadata = isRecord(execution.execution_metadata) ? execution.execution_metadata : undefined
  return {
    id: execution.id,
    index: execution.index ?? 0,
    predecessor_node_id: execution.predecessor_node_id ?? '',
    node_id: execution.node_id ?? '',
    node_type: isOneOf(BLOCKS, execution.node_type) ? execution.node_type : BlockEnum.DataSource,
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
    execution_metadata: metadata
      ? {
          total_tokens: getNumber(metadata, 'total_tokens') ?? 0,
          total_price: getNumber(metadata, 'total_price') ?? 0,
          currency: getString(metadata, 'currency') ?? '',
        }
      : undefined,
    // Datasource nodes never run inside an iteration or loop.
    metadata: { iterator_length: 0, iterator_index: 0, loop_length: 0, loop_index: 0 },
    created_at: execution.created_at ?? 0,
    created_by: execution.created_by_account ?? { id: '', name: '', email: '' },
    finished_at: execution.finished_at ?? 0,
    extras: execution.extras,
    retry_index: execution.retry_index ?? undefined,
  }
}
