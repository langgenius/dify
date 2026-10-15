import type { Viewport } from 'reactflow'
import type { Metadata, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { VisionFile } from '@/types/app'

export type LogAnnotation = {
  id: string
  content: string
  account: {
    id: string
    name: string
    email: string
  }
  created_at: number
}

export type Annotation = {
  id: string
  authorName: string
  logAnnotation?: LogAnnotation
  created_at?: number
}

type MessageContent = {
  id: string
  conversation_id: string
  query: string
  inputs: Record<string, any>
  message: { role: string; text: string; files?: VisionFile[] }[]
  message_tokens: number
  answer_tokens: number
  answer: string
  provider_response_latency: number
  created_at: number
  annotation: LogAnnotation
  annotation_hit_history: {
    annotation_id: string
    annotation_create_account: {
      id: string
      name: string
      email: string
    }
    created_at: number
  }
  feedbacks: Array<{
    rating: 'like' | 'dislike' | null
    content: string | null
    from_source?: 'admin' | 'user'
    from_end_user_id?: string
  }>
  message_files: VisionFile[]
  metadata: Metadata
  agent_thoughts: ThoughtItem[]
  workflow_run_id: string
  parent_message_id: string | null
}

export type ChatMessagesRequest = {
  conversation_id: string
  first_id?: string
  limit: number
}
export type ChatMessage = MessageContent

export type ChatMessagesResponse = {
  data: Array<ChatMessage>
  has_more: boolean
  limit: number
}

export type MessageRating = 'like' | 'dislike' | null

export type LogMessageFeedbacksRequest = {
  message_id: string
  rating: MessageRating
  content?: string
}

export type LogMessageFeedbacksResponse = {
  result: 'success' | 'error'
}

export type LogMessageAnnotationsRequest = Omit<LogMessageFeedbacksRequest, 'rating'>

export type LogMessageAnnotationsResponse = LogMessageFeedbacksResponse

export const WorkflowRunTriggeredFrom = {
  DEBUGGING: 'debugging',
  APP_RUN: 'app-run',
  RAG_PIPELINE_RUN: 'rag-pipeline-run',
  RAG_PIPELINE_DEBUGGING: 'rag-pipeline-debugging',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
  PLUGIN: 'plugin',
} as const

export type WorkflowRunTriggeredFrom =
  (typeof WorkflowRunTriggeredFrom)[keyof typeof WorkflowRunTriggeredFrom]

export type TriggerMetadata = {
  type?: string
  endpoint_id?: string
  plugin_unique_identifier?: string
  provider_id?: string
  event_name?: string
  icon_filename?: string
  icon_dark_filename?: string
  icon?: string | null
  icon_dark?: string | null
}

export type WorkflowLogDetails = {
  trigger_metadata?: TriggerMetadata
}

type AccountInfo = {
  id: string
  name: string
  email: string
}
type EndUserInfo = {
  id: string
  type: 'browser' | 'service_api'
  is_anonymous: boolean
  session_id: string
}
export type WorkflowRunDetailResponse = {
  id: string
  version: string
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  inputs: string
  inputs_truncated: boolean
  status:
    | 'scheduled'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'stopped'
    | 'partial-succeeded'
    | 'paused'
  outputs?: string
  outputs_truncated: boolean
  outputs_full_content?: {
    download_url: string
  }
  error?: string
  elapsed_time?: number
  total_tokens?: number
  total_steps: number
  created_by_role: 'account' | 'end_user'
  created_by_account?: AccountInfo
  created_by_end_user?: EndUserInfo
  created_at: number
  finished_at: number
  exceptions_count?: number
}

type AgentLogMeta = {
  status: string
  executor: string
  start_time: string
  elapsed_time: number
  total_tokens: number
  agent_mode: string
  iterations: number
  error?: string
}

export type ToolCall = {
  status: string
  error?: string | null
  time_cost?: number
  tool_icon: any
  tool_input?: any
  tool_output?: any
  tool_name?: string
  tool_label?: any
  tool_parameters?: any
}

export type AgentIteration = {
  created_at: string
  files: string[]
  thought: string
  tokens: number
  tool_calls: ToolCall[]
  tool_raw: {
    inputs: string
    outputs: string
  }
}

type AgentLogFile = {
  id: string
  type: string
  url: string
  name: string
  belongs_to: string
}

export type AgentLogDetailRequest = {
  conversation_id: string
  message_id: string
}

export type AgentLogDetailResponse = {
  meta: AgentLogMeta
  iterations: AgentIteration[]
  files: AgentLogFile[]
}
