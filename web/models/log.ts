import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'

type LogAnnotation = {
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

export type MessageRating = 'like' | 'dislike' | null

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
