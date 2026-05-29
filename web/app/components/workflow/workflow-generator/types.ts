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
  error?: string
}
