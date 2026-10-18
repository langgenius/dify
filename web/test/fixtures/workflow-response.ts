import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import { zWorkflowResponse } from '@dify/contracts/api/console/apps/zod.gen'

export const createWorkflowResponseFixture = (overrides: Partial<WorkflowResponse> = {}) =>
  zWorkflowResponse.parse({
    id: 'workflow-1',
    version: '1',
    hash: 'workflow-hash',
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    features: {},
    conversation_variables: [],
    environment_variables: [],
    rag_pipeline_variables: [],
    created_at: 1700000000,
    updated_at: 1700000000,
    marked_name: '',
    marked_comment: '',
    tool_published: false,
    ...overrides,
  })
