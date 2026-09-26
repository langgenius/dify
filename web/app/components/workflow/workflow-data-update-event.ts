import type { Viewport } from 'reactflow'
import type { useWorkflowStore } from './store'
import type { ConversationVariable, Edge, EnvironmentVariable, Node } from './types'
import type { EventEmitterValue } from '@/context/event-emitter'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { WORKFLOW_DATA_UPDATE } from './constants'

export type WorkflowDataUpdatePayload = {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  hash?: string
  features?: unknown
  conversation_variables?: ConversationVariable[]
  environment_variables?: EnvironmentVariable[]
  rag_pipeline_variables?: RAGPipelineVariables
}

export type WorkflowDataUpdateEvent = {
  type: typeof WORKFLOW_DATA_UPDATE
  payload: WorkflowDataUpdatePayload & {
    target: ReturnType<typeof useWorkflowStore>
  }
}

export function isWorkflowDataUpdateEvent(
  event: EventEmitterValue,
): event is WorkflowDataUpdateEvent {
  return typeof event !== 'string' && event.type === WORKFLOW_DATA_UPDATE
}
