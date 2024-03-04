import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'

export type FetchWorkflowDraftResponse = {
  id: string
  graph: {
    nodes: Node[]
    edges: Edge[]
  }
  features?: any
}
