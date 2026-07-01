import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { InputVar } from '@/models/pipeline'

export type SnippetSection = 'orchestrate'

export type SnippetListItem = {
  id: string
  name: string
  description: string
  updatedAt: string
  usage: string
  tags: Tag[]
  is_published?: boolean
  status?: string
}

export type SnippetDetail = {
  id: string
  name: string
  description: string
  updatedAt: string
  usage: string
  tags: Tag[]
  is_published?: boolean
  status?: string
}

export type SnippetCanvasData = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

export type SnippetInputField = InputVar

type SnippetDetailUIModel = {
  inputFieldCount: number
  checklistCount: number
  autoSavedAt: string
}

export type SnippetDetailPayload = {
  snippet: SnippetDetail
  graph: SnippetCanvasData
  inputFields: SnippetInputField[]
  uiMeta: SnippetDetailUIModel
}
