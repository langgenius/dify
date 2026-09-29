import type { Viewport } from 'reactflow'
import type { useWorkflowStore } from './store'
import type { ConversationVariable, Edge, EnvironmentVariable, Node } from './types'
import type { EventEmitterValue } from '@/context/event-emitter'
import type { RAGPipelineVariables } from '@/models/pipeline'
import type { FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { WORKFLOW_DATA_UPDATE, WORKFLOW_DRAFT_REPLACED } from './constants'

export type WorkflowDataUpdatePayload = {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  hash?: string
  features?: FetchAppWorkflowDraftResponse['features']
  conversation_variables?: ConversationVariable[]
  environment_variables?: EnvironmentVariable[]
  rag_pipeline_variables?: RAGPipelineVariables
}

export type WorkflowDataUpdateEvent = {
  type: typeof WORKFLOW_DATA_UPDATE
  payload: WorkflowDataUpdatePayload & {
    target: ReturnType<typeof useWorkflowStore>
    authoritativeDraft?: true
  }
}

export type WorkflowDraftReplacedEvent = {
  type: typeof WORKFLOW_DRAFT_REPLACED
  payload: {
    appId: string
    appliedReplacementId?: string
    replacementId?: string
    workflowReplacementToken?: number
    draft: FetchAppWorkflowDraftResponse
    collaborationGraph: Pick<WorkflowDataUpdatePayload, 'nodes' | 'edges'>
    workflowData: WorkflowDataUpdatePayload
  }
}

export function isWorkflowDataUpdateEvent(
  event: EventEmitterValue,
): event is WorkflowDataUpdateEvent {
  return typeof event !== 'string' && event.type === WORKFLOW_DATA_UPDATE
}

export function isWorkflowDraftReplacedEvent(
  event: EventEmitterValue,
): event is WorkflowDraftReplacedEvent {
  return typeof event !== 'string' && event.type === WORKFLOW_DRAFT_REPLACED
}
