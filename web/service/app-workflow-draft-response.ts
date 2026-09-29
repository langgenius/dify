import type { DraftWorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { AppWorkflowDraftFeatures, FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { CUSTOM_NOTE_NODE } from '@/app/components/workflow/note-node/constants'
import { BlockEnum } from '@/app/components/workflow/types'

const blockTypes = new Set<string>(Object.values(BlockEnum))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isOptionalNullable = (value: unknown, isValid: (value: unknown) => boolean): boolean =>
  value === undefined || value === null || isValid(value)

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNumber = (value: unknown): value is number => typeof value === 'number'
const isString = (value: unknown): value is string => typeof value === 'string'

type PersistedWorkflowNode = Record<string, unknown> & {
  id: string
  data: Record<string, unknown> & {
    type: BlockEnum | ''
    title?: string | null
    desc?: string | null
  }
  position?: { x: number; y: number } | null
}

type PersistedWorkflowEdge = Record<string, unknown> & {
  id: string
  source: string
  target: string
  data?: Record<string, unknown> | null
}

type PersistedWorkflowGraph = Record<string, unknown> & {
  nodes: PersistedWorkflowNode[]
  edges: PersistedWorkflowEdge[]
  viewport?: Viewport | null
}

const isBlockType = (value: unknown): value is BlockEnum => isString(value) && blockTypes.has(value)

const isWorkflowNode = (value: unknown): value is PersistedWorkflowNode => {
  if (!isRecord(value) || !isRecord(value.data)) return false

  return (
    isString(value.id) &&
    (isBlockType(value.data.type) || (value.type === CUSTOM_NOTE_NODE && value.data.type === '')) &&
    isOptionalNullable(value.data.title, isString) &&
    isOptionalNullable(value.data.desc, isString) &&
    isOptionalNullable(
      value.position,
      (position) => isRecord(position) && isNumber(position.x) && isNumber(position.y),
    )
  )
}

const isWorkflowEdge = (value: unknown): value is PersistedWorkflowEdge => {
  if (!isRecord(value)) return false
  if (!isString(value.id) || !isString(value.source) || !isString(value.target)) return false
  return isOptionalNullable(value.data, isRecord)
}

const isWorkflowGraph = (value: unknown): value is PersistedWorkflowGraph => {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.nodes) || !value.nodes.every(isWorkflowNode)) return false
  if (!Array.isArray(value.edges) || !value.edges.every(isWorkflowEdge)) return false
  if (value.viewport === undefined || value.viewport === null) return true

  return (
    isRecord(value.viewport) &&
    isNumber(value.viewport.x) &&
    isNumber(value.viewport.y) &&
    isNumber(value.viewport.zoom)
  )
}

const isFeatureToggle = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isOptionalNullable(value.enabled, isBoolean)

const isFileUpload = (value: unknown) => {
  if (!isFeatureToggle(value)) return false
  if (!isOptionalNullable(value.allowed_file_types, isStringArray)) return false
  if (!isOptionalNullable(value.allowed_file_extensions, isStringArray)) return false
  if (!isOptionalNullable(value.allowed_file_upload_methods, isStringArray)) return false
  if (!isOptionalNullable(value.number_limits, isNumber)) return false
  if (value.image === undefined || value.image === null) return true

  return (
    isFeatureToggle(value.image) &&
    isOptionalNullable(value.image.number_limits, isNumber) &&
    isOptionalNullable(value.image.transfer_methods, isStringArray)
  )
}

const isWorkflowFeatures = (value: unknown): value is AppWorkflowDraftFeatures => {
  if (!isRecord(value)) return false
  if (!isOptionalNullable(value.file_upload, isFileUpload)) return false
  if (!isOptionalNullable(value.opening_statement, isString)) return false
  if (!isOptionalNullable(value.suggested_questions, isStringArray)) return false

  return [
    'suggested_questions_after_answer',
    'speech_to_text',
    'text_to_speech',
    'retriever_resource',
    'sensitive_word_avoidance',
    'annotation_reply',
  ].every((key) => isOptionalNullable(value[key], isFeatureToggle))
}

const isEnvironmentVariable = (
  value: unknown,
): value is FetchAppWorkflowDraftResponse['environment_variables'][number] =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.name) &&
  isString(value.description) &&
  isString(value.value_type)

const isConversationVariable = (
  value: unknown,
): value is FetchAppWorkflowDraftResponse['conversation_variables'][number] =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.name) &&
  isString(value.description) &&
  isString(value.value_type)

const normalizeWorkflowGraph = (graph: PersistedWorkflowGraph) => {
  const needsInitialLayout = !graph.nodes[0]?.position
  const nodes = graph.nodes.map((node, index) => ({
    ...node,
    id: node.id,
    position:
      needsInitialLayout || !node.position
        ? {
            x: START_INITIAL_POSITION.x + index * NODE_WIDTH_X_OFFSET,
            y: START_INITIAL_POSITION.y,
          }
        : node.position,
    data: {
      ...node.data,
      type: node.data.type,
      title: node.data.title ?? '',
      desc: node.data.desc ?? '',
    },
  }))
  const nodeTypes = new Map(
    nodes.flatMap((node) => (isBlockType(node.data.type) ? [[node.id, node.data.type]] : [])),
  )
  const edges: Edge[] = graph.edges.map((edge) => {
    const sourceType = nodeTypes.get(edge.source)
    const targetType = nodeTypes.get(edge.target)

    return {
      ...edge,
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data:
        edge.data || sourceType || targetType
          ? {
              ...edge.data,
              sourceType:
                sourceType ??
                (isBlockType(edge.data?.sourceType) ? edge.data.sourceType : undefined),
              targetType:
                targetType ??
                (isBlockType(edge.data?.targetType) ? edge.data.targetType : undefined),
            }
          : undefined,
    }
  })

  return {
    ...graph,
    // The existing canvas Node type only models executable data.type values.
    // Notes use the outer custom-note renderer and must retain their empty data.type.
    nodes: nodes as Node[],
    edges,
    viewport: graph.viewport ?? undefined,
  }
}

export function parseAppWorkflowDraftResponse(
  draft: DraftWorkflowResponse,
): FetchAppWorkflowDraftResponse {
  const { graph, features, environment_variables, conversation_variables } = draft
  if (!isWorkflowGraph(graph)) throw new TypeError('Invalid app workflow draft graph')
  if (!isWorkflowFeatures(features)) throw new TypeError('Invalid app workflow draft features')
  if (!environment_variables.every(isEnvironmentVariable))
    throw new TypeError('Invalid app workflow draft environment variables')
  if (!conversation_variables.every(isConversationVariable))
    throw new TypeError('Invalid app workflow draft conversation variables')

  return {
    ...draft,
    graph: normalizeWorkflowGraph(graph),
    features,
    environment_variables,
    conversation_variables,
  }
}
