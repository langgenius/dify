import type { Viewport } from 'reactflow'
import type {
  BlockEnum,
  ConversationVariable,
  Edge,
  EnvironmentVariable,
  Node,
} from '@/app/components/workflow/types'
import type { TransferMethod } from '@/types/app'

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
  parallel_run_id?: string
  error?: string
  elapsed_time: number
  execution_metadata: {
    total_tokens: number
    total_price: number
    currency: string
    iteration_id?: string
    iteration_index?: number
    parallel_id?: string
    parallel_start_node_id?: string
    parent_parallel_id?: string
    parent_parallel_start_node_id?: string
    parallel_mode_run_id?: string
    iteration_duration_map?: IterationDurationMap
  }
  metadata: {
    iterator_length: number
    iterator_index: number
  }
  created_at: number
  created_by: {
    id: string
    name: string
    email: string
  }
  iterDurationMap?: IterationDurationMap
  finished_at: number
  extras?: any
  expand?: boolean // for UI
  details?: NodeTracing[][] // iteration detail
  parallel_id?: string
  parallel_start_node_id?: string
  parent_parallel_id?: string
  parent_parallel_start_node_id?: string
}

export type FetchWorkflowDraftResponse = {
  id: string
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  features?: any
  created_at: number
  created_by: {
    id: string
    name: string
    email: string
  }
  hash: string
  updated_at: number
  tool_published: boolean
  environment_variables?: EnvironmentVariable[]
  conversation_variables?: ConversationVariable[]
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
    sequence_number: number
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
    created_by: {
      id: string
      name: string
      email: string
    }
    finished_at: number
    files?: FileResponse[]
  }
}

export type NodeStartedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    iteration_id?: string
    parallel_run_id?: string
    node_type: string
    index: number
    predecessor_node_id?: string
    inputs: any
    created_at: number
    extras?: any
  }
}

export type FileResponse = {
  related_id: string
  extension: string
  filename: string
  size: number
  mime_type: string
  transfer_method: TransferMethod
  type: string
  url: string
}

export type NodeFinishedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    iteration_id?: string
    node_type: string
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
      parallel_id?: string
      parallel_start_node_id?: string
      iteration_index?: number
      iteration_id?: string
      parallel_mode_run_id: string
    }
    created_at: number
    files?: FileResponse[]
  }
}

export type IterationStartedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    metadata: {
      iterator_length: number
      iteration_id: string
      iteration_index: number
    }
    created_at: number
    extras?: any
  }
}

export type IterationNextResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    index: number
    output: any
    extras?: any
    created_at: number
    parallel_mode_run_id: string
    execution_metadata: {
      parallel_id?: string
      iteration_index: number
      parallel_mode_run_id?: string
    }
    duration?: number
  }
}

export type IterationFinishedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    id: string
    node_id: string
    outputs: any
    extras?: any
    status: string
    created_at: number
    error: string
    execution_metadata: {
      parallel_id?: string
    }
  }
}

export type ParallelBranchStartedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    parallel_id: string
    parallel_start_node_id: string
    parent_parallel_id: string
    parent_parallel_start_node_id: string
    iteration_id?: string
    created_at: number
  }
}

export type ParallelBranchFinishedResponse = {
  task_id: string
  workflow_run_id: string
  event: string
  data: {
    parallel_id: string
    parallel_start_node_id: string
    parent_parallel_id: string
    parent_parallel_start_node_id: string
    iteration_id?: string
    status: string
    created_at: number
    error: string
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

export type WorkflowRunHistory = {
  id: string
  sequence_number: number
  version: string
  conversation_id?: string
  message_id?: string
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  inputs: Record<string, string>
  status: string
  outputs: Record<string, any>
  error?: string
  elapsed_time: number
  total_tokens: number
  total_steps: number
  created_at: number
  finished_at: number
  created_by_account: {
    id: string
    name: string
    email: string
  }
}
export type WorkflowRunHistoryResponse = {
  data: WorkflowRunHistory[]
}

export type ChatRunHistoryResponse = {
  data: WorkflowRunHistory[]
}

export type NodesDefaultConfigsResponse = {
  type: string
  config: any
}[]

export type ConversationVariableResponse = {
  data: (ConversationVariable & { updated_at: number; created_at: number })[]
  has_more: boolean
  limit: number
  total: number
  page: number
}

export type IterationDurationMap = Record<string, number>
