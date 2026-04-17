import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { InputVar } from '@/models/pipeline'

export type SnippetSection = 'orchestrate' | 'evaluation'

export type SnippetListItem = {
  id: string
  name: string
  description: string
  author: string
  updatedAt: string
  usage: string
  icon: string
  iconBackground: string
  status?: string
}

export type SnippetDetail = {
  id: string
  name: string
  description: string
  author: string
  updatedAt: string
  usage: string
  icon: string
  iconBackground: string
  status?: string
}

export type SnippetCanvasData = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

export type SnippetInputField = InputVar

export type SnippetDetailUIModel = {
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
