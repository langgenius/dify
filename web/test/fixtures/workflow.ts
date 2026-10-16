import type { FetchWorkflowDraftResponse } from '@/types/workflow'

export function createWorkflowDraftFixture(
  overrides: Partial<FetchWorkflowDraftResponse> = {},
): FetchWorkflowDraftResponse {
  return {
    id: 'workflow-1',
    graph: { nodes: [], edges: [] },
    features: {},
    hash: 'hash-1',
    version: 'draft',
    version_number: null,
    marked_name: '',
    marked_comment: '',
    created_at: 1_700_000_000,
    created_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    updated_at: 1_700_000_000,
    updated_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    tool_published: false,
    environment_variables: [],
    conversation_variables: [],
    rag_pipeline_variables: [],
    ...overrides,
  }
}
