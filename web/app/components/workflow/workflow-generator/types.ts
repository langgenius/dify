import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'

export type WorkflowGeneratorMode = 'workflow' | 'advanced-chat'

export type GeneratedGraph = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

export type GenerateWorkflowResponse = {
  graph: GeneratedGraph
  message?: string
  /**
   * Planner-picked product-style name. Used by applyToNewApp; empty triggers
   * a deriveAppName(instruction) fallback.
   */
  app_name?: string
  /** Planner-picked emoji icon for the new App. Empty triggers a 🤖 fallback. */
  icon?: string
  error?: string
}
