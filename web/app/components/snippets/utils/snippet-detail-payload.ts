import type { InputVar as SnippetInputFieldUIModel } from '@/models/pipeline'
import type {
  SnippetCanvasData,
  SnippetDetailPayload,
  SnippetDetail as SnippetDetailUIModel,
  SnippetListItem as SnippetListItemUIModel,
} from '@/models/snippet'
import type { Snippet as SnippetContract, SnippetWorkflow } from '@/types/snippet'
import dayjs from 'dayjs'

type SnippetSummary = Pick<
  SnippetContract,
  'id' | 'name' | 'description' | 'use_count' | 'tags' | 'updated_at' | 'is_published'
>

const DEFAULT_GRAPH: SnippetCanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const toMilliseconds = (timestamp?: number) => {
  if (!timestamp) return undefined

  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
}

const formatTimestamp = (timestamp?: number) => {
  const milliseconds = toMilliseconds(timestamp)
  if (!milliseconds) return ''

  return dayjs(milliseconds).format('YYYY-MM-DD HH:mm')
}

const toSnippetListItem = (snippet: SnippetSummary): SnippetListItemUIModel => {
  return {
    id: snippet.id,
    name: snippet.name,
    description: snippet.description,
    updatedAt: formatTimestamp(snippet.updated_at),
    usage: String(snippet.use_count ?? 0),
    tags: snippet.tags,
    is_published: snippet.is_published,
    status: undefined,
  }
}

const toSnippetDetail = (snippet: SnippetContract): SnippetDetailUIModel => {
  return {
    ...toSnippetListItem(snippet),
  }
}

const toSnippetCanvasData = (workflow?: SnippetWorkflow | null): SnippetCanvasData => {
  const graph = workflow?.graph

  if (!graph || typeof graph !== 'object') return DEFAULT_GRAPH

  const graphRecord = graph

  return {
    nodes: Array.isArray(graphRecord.nodes)
      ? (graphRecord.nodes as SnippetCanvasData['nodes'])
      : DEFAULT_GRAPH.nodes,
    edges: Array.isArray(graphRecord.edges)
      ? (graphRecord.edges as SnippetCanvasData['edges'])
      : DEFAULT_GRAPH.edges,
    viewport:
      graphRecord.viewport && typeof graphRecord.viewport === 'object'
        ? (graphRecord.viewport as SnippetCanvasData['viewport'])
        : DEFAULT_GRAPH.viewport,
  }
}

export const buildSnippetDetailPayload = (
  snippet: SnippetContract,
  workflow?: SnippetWorkflow | null,
): SnippetDetailPayload => {
  const inputFields = Array.isArray(workflow?.input_fields)
    ? (workflow.input_fields as SnippetInputFieldUIModel[])
    : []

  return {
    snippet: toSnippetDetail(snippet),
    graph: toSnippetCanvasData(workflow),
    inputFields,
    uiMeta: {
      inputFieldCount: inputFields.length,
      checklistCount: 0,
      autoSavedAt: formatTimestamp(workflow?.updated_at ?? snippet.updated_at),
    },
  }
}
