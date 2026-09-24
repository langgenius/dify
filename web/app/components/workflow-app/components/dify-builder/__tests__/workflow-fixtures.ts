import type { DifyBuilderWorkflowEventData } from '@dify/contracts/api/console/dify-builder/types.gen'

export type WorkflowPayload = DifyBuilderWorkflowEventData['payload']
export type PayloadFor<E extends WorkflowPayload['event']> = Extract<WorkflowPayload, { event: E }>

export const workflowEvent = (
  payload: WorkflowPayload,
  overrides: Partial<DifyBuilderWorkflowEventData> = {},
): DifyBuilderWorkflowEventData => ({
  session_id: 'session-1',
  operation_id: 'op',
  at_version: 2,
  revision: 1,
  payload,
  ...overrides,
})

export const runStarted = (runId = 'dify-run'): PayloadFor<'workflow_started'> => ({
  event: 'workflow_started',
  task_id: 'task-1',
  workflow_run_id: runId,
  data: {
    id: runId,
    workflow_id: 'workflow-1',
    inputs: { query: 'hello' },
    created_at: 1,
    reason: 'initial',
  },
})

export const nodeStarted = (nodeId = 'answer'): PayloadFor<'node_started'> => ({
  event: 'node_started',
  task_id: 'task-1',
  workflow_run_id: 'dify-run',
  data: {
    id: `exec-${nodeId}`,
    node_id: nodeId,
    node_type: 'code',
    title: nodeId,
    index: 1,
    predecessor_node_id: 'start',
    inputs: { query: 'hello' },
    inputs_truncated: false,
    created_at: 1,
  },
})

export const nodeFinished = (nodeId = 'answer'): PayloadFor<'node_finished'> => ({
  ...nodeStarted(nodeId),
  event: 'node_finished',
  data: {
    ...nodeStarted(nodeId).data,
    status: 'succeeded',
    outputs: { result: '42' },
    outputs_truncated: true,
    process_data: { trace: 'native' },
    process_data_truncated: true,
    elapsed_time: 2,
    finished_at: 3,
    execution_metadata: { total_tokens: 7 },
  },
})

export const runFinished = (
  status: PayloadFor<'workflow_finished'>['data']['status'] = 'succeeded',
): PayloadFor<'workflow_finished'> => ({
  event: 'workflow_finished',
  task_id: 'task-1',
  workflow_run_id: 'dify-run',
  data: {
    id: 'dify-run',
    workflow_id: 'workflow-1',
    status,
    outputs: { result: '42' },
    elapsed_time: 2,
    total_tokens: 7,
    total_steps: 2,
    created_at: 1,
    finished_at: 3,
  },
})
