import type { Viewport } from 'reactflow'
import type { VisionFile } from '@/types/app'
import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'

// Log type contains key:string conversation_id:string created_at:string quesiton:string answer:string
export type Conversation = {
  id: string
  key: string
  conversationId: string
  question: string
  answer: string
  userRate: number
  adminRate: number
}

export type ConversationListResponse = {
  logs: Conversation[]
}

export const fetchLogs = (url: string) =>
  fetch(url).then<ConversationListResponse>(r => r.json())

export const CompletionParams = ['temperature', 'top_p', 'presence_penalty', 'max_token', 'stop', 'frequency_penalty'] as const

export type CompletionParamType = typeof CompletionParams[number]

export type CompletionParamsType = {
  max_tokens: number
  temperature: number
  top_p: number
  stop: string[]
  presence_penalty: number
  frequency_penalty: number
}

export type LogModelConfig = {
  name: string
  provider: string
  completion_params: CompletionParamsType
}

export type ModelConfigDetail = {
  introduction: string
  prompt_template: string
  prompt_variables: Array<{
    key: string
    name: string
    description: string
    type: string | number
    default: string
    options: string[]
  }>
  completion_params: CompletionParamsType
}

export type LogAnnotation = {
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

export type MessageContent = {
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
  agent_thoughts: any[] // TODO
  workflow_run_id: string
}

export type CompletionConversationGeneralDetail = {
  id: string
  status: 'normal' | 'finished'
  from_source: 'api' | 'console'
  from_end_user_id: string
  from_end_user_session_id: string
  from_account_id: string
  read_at: Date
  created_at: number
  annotation: Annotation
  user_feedback_stats: {
    like: number
    dislike: number
  }
  admin_feedback_stats: {
    like: number
    dislike: number
  }
  model_config: {
    provider: string
    model_id: string
    configs: Pick<ModelConfigDetail, 'prompt_template'>
  }
  message: Pick<MessageContent, 'inputs' | 'query' | 'answer' | 'message'>
}

export type CompletionConversationFullDetailResponse = {
  id: string
  status: 'normal' | 'finished'
  from_source: 'api' | 'console'
  from_end_user_id: string
  from_account_id: string
  // read_at: Date
  created_at: number
  model_config: {
    provider: string
    model_id: string
    configs: ModelConfigDetail
  }
  message: MessageContent
}

export type CompletionConversationsResponse = {
  data: Array<CompletionConversationGeneralDetail>
  has_more: boolean
  limit: number
  total: number
  page: number
}

export type CompletionConversationsRequest = {
  keyword: string
  start: string
  end: string
  annotation_status: string
  page: number
  limit: number // The default value is 20 and the range is 1-100
}

export type ChatConversationGeneralDetail = Omit<CompletionConversationGeneralDetail, 'message' | 'annotation'> & {
  summary: string
  message_count: number
  annotated: boolean
}

export type ChatConversationsResponse = {
  data: Array<ChatConversationGeneralDetail>
  has_more: boolean
  limit: number
  total: number
  page: number
}

export type ChatConversationsRequest = CompletionConversationsRequest & { message_count: number }

export type ChatConversationFullDetailResponse = Omit<CompletionConversationGeneralDetail, 'message' | 'model_config'> & {
  message_count: number
  model_config: {
    provider: string
    model_id: string
    configs: ModelConfigDetail
    model: LogModelConfig
  }
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

export const MessageRatings = ['like', 'dislike', null] as const
export type MessageRating = typeof MessageRatings[number]

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

export type AnnotationsCountResponse = {
  count: number
}

export type WorkflowRunDetail = {
  id: string
  version: string
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  error?: string
  elapsed_time: number
  total_tokens: number
  total_price: number
  currency: string
  total_steps: number
  finished_at: number
}
export type AccountInfo = {
  id: string
  name: string
  email: string
}
export type EndUserInfo = {
  id: string
  type: 'browser' | 'service_api'
  is_anonymous: boolean
  session_id: string
}
export type WorkflowAppLogDetail = {
  id: string
  workflow_run: WorkflowRunDetail
  created_from: 'service-api' | 'web-app' | 'explore'
  created_by_role: 'account' | 'end_user'
  created_by_account?: AccountInfo
  created_by_end_user?: EndUserInfo
  created_at: number
  read_at?: number
}
export type WorkflowLogsResponse = {
  data: Array<WorkflowAppLogDetail>
  has_more: boolean
  limit: number
  total: number
  page: number
}
export type WorkflowLogsRequest = {
  keyword: string
  status: string
  page: number
  limit: number // The default value is 20 and the range is 1-100
}

export type WorkflowRunDetailResponse = {
  id: string
  sequence_number: number
  version: string
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  inputs: string
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  outputs?: string
  error?: string
  elapsed_time?: number
  total_tokens?: number
  total_steps: number
  created_by_role: 'account' | 'end_user'
  created_by_account?: AccountInfo
  created_by_end_user?: EndUserInfo
  created_at: number
  finished_at: number
}

export type AgentLogMeta = {
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

export type AgentLogFile = {
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
