import type {
  WorkflowGeneratePayload,
  WorkflowGenerateResponse,
} from '@dify/contracts/api/console/workflow-generate/types.gen'
import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'

export type WorkflowGeneratorMode = Exclude<WorkflowGeneratePayload['mode'], 'auto'>

/**
 * `create` builds a brand-new app from scratch; `refine` feeds the current
 * Studio draft graph to the generator as context so it amends what's already
 * on the canvas. Only `refine` requires an open Studio (a `currentAppId`).
 */
export type WorkflowGeneratorIntent = 'create' | 'refine'

/** React Flow-compatible view of a validated generator graph at the canvas boundary. */
export type GeneratedGraph = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}
export type GenerateWorkflowResponse = WorkflowGenerateResponse
