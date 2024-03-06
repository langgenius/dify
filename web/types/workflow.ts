import type { Viewport } from 'reactflow'
import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'

export type FetchWorkflowDraftResponse = {
  id: string
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  features?: any
  updated_at: number
}
