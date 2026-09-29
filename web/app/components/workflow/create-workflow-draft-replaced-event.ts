import type { WorkflowDataUpdater } from './types'
import type { WorkflowDraftReplacedEvent } from './workflow-data-update-event'
import type { FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { WORKFLOW_DRAFT_REPLACED } from './constants'
import { initialEdges, initialNodes } from './utils'

export const createWorkflowDraftReplacedEvent = (
  appId: string,
  draft: FetchAppWorkflowDraftResponse,
  canvasGraph: WorkflowDataUpdater,
  appliedReplacementId?: string,
  replacementId?: string,
  workflowReplacementToken?: number,
): WorkflowDraftReplacedEvent => {
  const { nodes, edges } = draft.graph

  return {
    type: WORKFLOW_DRAFT_REPLACED,
    payload: {
      appId,
      appliedReplacementId,
      replacementId,
      workflowReplacementToken,
      draft,
      collaborationGraph: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
      },
      workflowData: {
        nodes: initialNodes(canvasGraph.nodes, canvasGraph.edges),
        edges: initialEdges(canvasGraph.edges, canvasGraph.nodes),
        viewport: canvasGraph.viewport,
        features: draft.features,
        hash: draft.hash,
        conversation_variables: draft.conversation_variables || [],
        environment_variables: draft.environment_variables || [],
      },
    },
  }
}
