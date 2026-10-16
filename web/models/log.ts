import type {
  AgentIterationLogResponse,
  AgentLogResponse,
  AgentToolCallResponse,
  WorkflowRunDetailResponse as WorkflowRunDetailContract,
} from '@dify/contracts/api/console/apps/types.gen'
import type { WorkflowCanvasGraph } from '@/types/workflow'

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

// Stored run details carry the canvas graph as JSON; the editor reads it as typed nodes and edges.
export type WorkflowRunDetailResponse = Omit<WorkflowRunDetailContract, 'graph'> & {
  graph: WorkflowCanvasGraph
}

export type AgentLogDetailResponse = AgentLogResponse
export type AgentIteration = AgentIterationLogResponse
export type ToolCall = AgentToolCallResponse
