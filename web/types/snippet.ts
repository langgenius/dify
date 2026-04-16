import type { AppIconType } from '@/types/app'

export type SnippetType = 'node' | 'group'

export type SnippetIconInfo = {
  icon_type: AppIconType | null
  icon: string
  icon_background?: string
  icon_url?: string
}

export type SnippetInputField = Record<string, unknown>

export type Snippet = {
  id: string
  name: string
  description: string
  type: SnippetType
  is_published: boolean
  version: string
  use_count: number
  icon_info: SnippetIconInfo
  input_fields: SnippetInputField[]
  created_at: number
  updated_at: number
  author: string
}

export type SnippetListItem = Omit<Snippet, 'version' | 'input_fields'>

export type SnippetListResponse = {
  data: SnippetListItem[]
  page: number
  limit: number
  total: number
  has_more: boolean
}

export type CreateSnippetPayload = {
  name: string
  description?: string
  type?: SnippetType
  icon_info?: SnippetIconInfo
  input_fields?: SnippetInputField[]
}

export type UpdateSnippetPayload = {
  name?: string
  description?: string
  icon_info?: SnippetIconInfo
}

export type SnippetImportPayload = {
  mode?: string
  yaml_content?: string
  yaml_url?: string
  snippet_id?: string
  name?: string
  description?: string
}

export type SnippetDSLImportResponse = {
  id: string
  status: string
  snippet_id?: string
  current_dsl_version?: string
  imported_dsl_version?: string
  error: string
}

export type IncrementSnippetUseCountResponse = {
  result: string
  use_count: number
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
  graph?: Record<string, unknown>
  hash?: string
  environment_variables?: Record<string, unknown>[]
  conversation_variables?: Record<string, unknown>[]
  input_fields?: SnippetInputField[]
}

export type SnippetDraftSyncResponse = {
  result: string
  hash: string
  updated_at: number
}

export type SnippetDraftConfig = {
  parallel_depth_limit: number
}

export type PublishSnippetWorkflowResponse = {
  result: string
  created_at: number
}

export type WorkflowRunDetail = {
  id: string
  version: string
  status: 'running' | 'succeeded' | 'failed' | 'stopped' | 'partial-succeeded'
  elapsed_time: number
  total_tokens: number
  total_steps: number
  created_at: number
  finished_at: number
  exceptions_count: number
}

export type WorkflowRunPagination = {
  limit: number
  has_more: boolean
  data: WorkflowRunDetail[]
}

export type WorkflowNodeExecution = {
  id: string
  index: number
  node_id: string
  node_type: string
  title: string
  inputs: Record<string, unknown>
  process_data: Record<string, unknown>
  outputs: Record<string, unknown>
  status: string
  error: string
  elapsed_time: number
  created_at: number
  finished_at: number
}

export type WorkflowNodeExecutionListResponse = {
  data: WorkflowNodeExecution[]
}

export type SnippetDraftNodeRunPayload = {
  inputs?: Record<string, unknown>
  query?: string
  files?: Record<string, unknown>[]
}

export type SnippetDraftRunPayload = {
  inputs?: Record<string, unknown>
  files?: Record<string, unknown>[]
}

export type SnippetIterationNodeRunPayload = {
  inputs?: Record<string, unknown>
}

export type SnippetLoopNodeRunPayload = {
  inputs?: Record<string, unknown>
}
