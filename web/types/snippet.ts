import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'

type SnippetType = 'node' | 'group'

type SnippetInputField = Record<string, unknown>

type SnippetAccount = {
  id: string
  name: string
  email: string
}

export type SnippetListItem = {
  id: string
  name: string
  description: string | null
  type: SnippetType
  is_published: boolean
  version: number
  use_count: number
  icon_info?: Record<string, unknown> | null
  tags: TagResponse[]
  created_at: number
  created_by: string | null
  author_name?: string | null
  updated_at: number
  updated_by: string | null
}

export type Snippet = Omit<SnippetListItem, 'created_by' | 'updated_by' | 'author_name'> & {
  graph: Record<string, unknown>
  input_fields: SnippetInputField[]
  created_by: SnippetAccount | null
  updated_by: SnippetAccount | null
}

export type SnippetDSLImportResponse = {
  id: string
  status: string
  snippet_id: string | null
  current_dsl_version: string
  imported_dsl_version: string
  error: string
}

export type SnippetWorkflow = {
  id: string
  graph: Record<string, unknown>
  features: Record<string, unknown>
  input_fields?: SnippetInputField[]
  hash: string
  created_at: number
  updated_at: number
}

export type SnippetDraftSyncPayload = {
  graph: Record<string, unknown>
  hash?: string
  conversation_variables?: Record<string, unknown>[]
  input_fields?: SnippetInputField[]
}

export type SnippetDraftSyncResponse = {
  result: string
  hash: string
  updated_at: number
}

export type SnippetDraftRunPayload = {
  inputs: Record<string, unknown>
  files?: Record<string, unknown>[]
}
