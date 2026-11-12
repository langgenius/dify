import type { WorkflowRunDetailResponse } from '@/models/log'

export function createLogRun(id: string): WorkflowRunDetailResponse {
  return {
    id,
    version: '1',
    graph: { nodes: [], edges: [] },
    inputs: '{}',
    inputs_truncated: false,
    outputs: '{}',
    outputs_truncated: false,
    status: 'succeeded',
    elapsed_time: 1,
    total_tokens: 3,
    total_steps: 1,
    created_by_role: 'account',
    created_by_account: { id: 'user', name: 'Alice', email: 'alice@example.com' },
    created_at: 1710000000,
    finished_at: 1710000001,
  }
}
