import type { Viewport } from 'reactflow'
import type {
  BlockEnum,
  Edge,
  Node,
} from '@/app/components/workflow/types'

export type NodeTracing = {
  id: string
  index: number
  predecessor_node_id: string
  node_id: string
  node_type: BlockEnum
  title: string
  inputs: any
  process_data: any
  outputs?: any
  status: string
  error?: string
  elapsed_time: number
  execution_metadata: {
    total_tokens: number
    total_price: number
    currency: string
  }
  created_at: number
  created_by: {
    id: string
    name: string
    email: string
  }
  finished_at: number
}

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

export type NodeTracingListResponse = {
  data: NodeTracing[]
}

export type WorkflowStartedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    workflow_id: string
    created_at: number
  }
}

export type WorkflowFinishedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    workflow_id: string
    status: string
    outputs: any
    error: string
    elapsed_time: number
    total_tokens: number
    total_steps: number
    created_at: number
    finished_at: number
  }
}

export type NodeStartedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    index: number
    predecessor_node_id?: string
    inputs: any
    created_at: number
  }
}

export type NodeFinishedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    index: number
    predecessor_node_id?: string
    inputs: any
    process_data: any
    outputs: any
    status: string
    error: string
    elapsed_time: number
    execution_metadata: {
      total_tokens: number
      total_price: number
      currency: string
    }
    created_at: number
  }
}

export type TextChunkResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    text: string
  }
}

export type TextReplaceResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    text: string
  }
}
