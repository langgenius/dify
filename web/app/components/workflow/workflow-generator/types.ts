import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'

export type WorkflowGeneratorMode = 'workflow' | 'advanced-chat'

/**
 * `create` builds a brand-new app from scratch; `refine` feeds the current
 * Studio draft graph to the generator as context so it amends what's already
 * on the canvas. Only `refine` requires an open Studio (a `currentAppId`).
 */
export type WorkflowGeneratorIntent = 'create' | 'refine'

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
