import type { AppModelSelectionResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Viewport } from 'reactflow'
import type { Features as FeaturesData, FileUpload } from '@/app/components/base/features/types'
import type {
  Edge,
  EnvironmentVariable,
  EnvironmentVariableValue,
  Node,
} from '@/app/components/workflow/types'
import type { TransferMethod } from '@/types/app'
import { Resolution, TtsAutoPlay } from '@/types/app'

// Versions, published workflows and templates store graph, features and variable values as
// free-form JSON. These helpers narrow that JSON to what the editor can load, dropping anything
// that does not have the expected shape instead of trusting it.

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isOneOf = <T extends string>(values: Record<string, T>, value: unknown): value is T =>
  typeof value === 'string' && Object.values<string>(values).includes(value)

const getString = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

const getNumber = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

const getBoolean = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

const getRecord = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

const getStrings = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

// Nodes without a position are kept: `initialNodes` lays them out when the canvas loads.
const isGraphNode = (value: unknown): value is Node =>
  isRecord(value) && typeof value.id === 'string' && isRecord(value.data)

const isPlacedGraphNode = (value: unknown): value is Node =>
  isGraphNode(value) && isRecord(value.position)

const isGraphEdge = (value: unknown): value is Edge =>
  isRecord(value) && typeof value.source === 'string' && typeof value.target === 'string'

export const toGraphNodes = (graph: Record<string, unknown>) =>
  Array.isArray(graph.nodes) ? graph.nodes.filter(isGraphNode) : []

// For read-only previews that render nodes where they were saved, without a layout pass.
export const toPlacedGraphNodes = (graph: Record<string, unknown>) =>
  Array.isArray(graph.nodes) ? graph.nodes.filter(isPlacedGraphNode) : []

export const toGraphEdges = (graph: Record<string, unknown>) =>
  Array.isArray(graph.edges) ? graph.edges.filter(isGraphEdge) : []

// The saved viewport, or undefined so the canvas keeps the current pan and zoom.
export const toStoredViewport = (graph: Record<string, unknown>): Viewport | undefined => {
  const viewport = getRecord(graph, 'viewport')
  if (!viewport) return undefined
  const x = getNumber(viewport, 'x')
  const y = getNumber(viewport, 'y')
  const zoom = getNumber(viewport, 'zoom')
  return x === undefined || y === undefined || zoom === undefined ? undefined : { x, y, zoom }
}

export const toViewport = (graph: Record<string, unknown>): Viewport =>
  toStoredViewport(graph) ?? { x: 0, y: 0, zoom: 1 }

const ENVIRONMENT_VARIABLE_TYPES = {
  string: 'string',
  number: 'number',
  secret: 'secret',
  llm: 'llm',
} satisfies Record<EnvironmentVariable['value_type'], EnvironmentVariable['value_type']>

const toEnvironmentVariableValue = (value: unknown): EnvironmentVariableValue | undefined => {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!isRecord(value)) return undefined
  const provider = getString(value, 'provider')
  const name = getString(value, 'name')
  const mode = getString(value, 'mode')
  if (provider === undefined || name === undefined || mode === undefined) return undefined
  return { provider, name, mode, completion_params: getRecord(value, 'completion_params') }
}

type EnvironmentVariableSource = {
  id: string
  name: string
  description: string
  value: unknown
  value_type: string
}

// Variables of an unknown type or with a value the editor cannot hold are left out.
export const toEnvironmentVariables = (
  variables: EnvironmentVariableSource[],
): EnvironmentVariable[] =>
  variables.flatMap((variable) => {
    const value = toEnvironmentVariableValue(variable.value)
    if (!isOneOf(ENVIRONMENT_VARIABLE_TYPES, variable.value_type) || value === undefined) return []
    return [
      {
        id: variable.id,
        name: variable.name,
        description: variable.description,
        value,
        value_type: variable.value_type,
      },
    ]
  })

const LLM_MODES = { chat: 'chat', completion: 'completion' } as const

const toModelSelection = (
  model: Record<string, unknown> | undefined,
): AppModelSelectionResponse | undefined => {
  if (!model) return undefined
  const mode = model.mode
  return {
    provider: getString(model, 'provider'),
    name: getString(model, 'name'),
    mode: isOneOf(LLM_MODES, mode) ? mode : undefined,
    completion_params: getRecord(model, 'completion_params'),
  }
}

const TRANSFER_METHODS = {
  all: 'all',
  local_file: 'local_file',
  remote_url: 'remote_url',
  datasource_file: 'datasource_file',
  tool_file: 'tool_file',
} satisfies Record<TransferMethod, TransferMethod>

const toTransferMethods = (record: Record<string, unknown>, key: string) =>
  getStrings(record, key)?.filter((method) => isOneOf(TRANSFER_METHODS, method))

const toFileTypeUpload = (upload: Record<string, unknown> | undefined) =>
  upload && {
    enabled: getBoolean(upload, 'enabled'),
    number_limits: getNumber(upload, 'number_limits'),
    transfer_methods: toTransferMethods(upload, 'transfer_methods'),
  }

const toFileUpload = (fileUpload: Record<string, unknown> | undefined): FileUpload | undefined => {
  if (!fileUpload) return undefined
  const image = getRecord(fileUpload, 'image')
  const detail = image?.detail
  const previewConfig = getRecord(fileUpload, 'preview_config')
  const previewMode = previewConfig?.mode
  return {
    enabled: getBoolean(fileUpload, 'enabled'),
    image: image && {
      ...toFileTypeUpload(image),
      detail: isOneOf(Resolution, detail) ? detail : undefined,
    },
    document: toFileTypeUpload(getRecord(fileUpload, 'document')),
    audio: toFileTypeUpload(getRecord(fileUpload, 'audio')),
    video: toFileTypeUpload(getRecord(fileUpload, 'video')),
    custom: toFileTypeUpload(getRecord(fileUpload, 'custom')),
    allowed_file_types: getStrings(fileUpload, 'allowed_file_types'),
    allowed_file_extensions: getStrings(fileUpload, 'allowed_file_extensions'),
    allowed_file_upload_methods: toTransferMethods(fileUpload, 'allowed_file_upload_methods'),
    number_limits: getNumber(fileUpload, 'number_limits'),
    preview_config: previewConfig && {
      mode: previewMode === 'new_page' || previewMode === 'current_page' ? previewMode : undefined,
      file_type_list: getStrings(previewConfig, 'file_type_list'),
    },
  }
}

const toToggle = (feature: Record<string, unknown> | undefined) =>
  feature && { enabled: getBoolean(feature, 'enabled') }

// Maps the workflow `features` JSON to the editor's feature panel state.
export const toFeaturesData = (features: Record<string, unknown>): FeaturesData => {
  const suggested = getRecord(features, 'suggested_questions_after_answer')
  const textToSpeech = getRecord(features, 'text_to_speech')
  const moderation = getRecord(features, 'sensitive_word_avoidance')
  const suggestedQuestions = getStrings(features, 'suggested_questions') ?? []
  const openingStatement = getString(features, 'opening_statement')
  const autoPlay = textToSpeech?.autoPlay
  return {
    opening: {
      enabled: !!openingStatement || !!suggestedQuestions.length,
      opening_statement: openingStatement,
      suggested_questions: suggestedQuestions,
    },
    suggested: suggested && {
      enabled: getBoolean(suggested, 'enabled'),
      model: toModelSelection(getRecord(suggested, 'model')),
      prompt: getString(suggested, 'prompt'),
    },
    text2speech: textToSpeech && {
      enabled: getBoolean(textToSpeech, 'enabled'),
      language: getString(textToSpeech, 'language'),
      voice: getString(textToSpeech, 'voice'),
      autoPlay: isOneOf(TtsAutoPlay, autoPlay) ? autoPlay : undefined,
    },
    speech2text: toToggle(getRecord(features, 'speech_to_text')),
    citation: toToggle(getRecord(features, 'retriever_resource')),
    moderation: moderation && {
      enabled: getBoolean(moderation, 'enabled'),
      type: getString(moderation, 'type'),
      config: getRecord(moderation, 'config'),
    },
    file: toFileUpload(getRecord(features, 'file_upload')),
  }
}
