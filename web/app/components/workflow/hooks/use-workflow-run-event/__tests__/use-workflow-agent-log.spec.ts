import type { AgentLogResponse } from '@/types/workflow'
import { act } from '@testing-library/react'
import { createNodeTracing } from '../../../__tests__/fixtures'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowAgentLog } from '../use-workflow-agent-log'

const event = (
  messageId: string,
  overrides: Partial<AgentLogResponse['data']> = {},
): AgentLogResponse => ({
  task_id: 'task-1',
  event: 'agent_log',
  data: {
    node_execution_id: 'execution-1',
    node_id: 'n1',
    message_id: messageId,
    label: 'Tool call',
    data: { result: 'initial' },
    status: 'start',
    children: [],
    ...overrides,
  },
})

it.each([undefined, { total_tokens: 0, total_price: 0, currency: 'USD' }])(
  'initializes logs without dropping execution metadata (%j)',
  (execution_metadata) => {
    const { result, store } = renderWorkflowHook(useWorkflowAgentLog, {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [createNodeTracing({ node_id: 'n1', execution_metadata })],
        }),
      },
    })
    const incoming = event('m1')
    act(() => result.current.handleWorkflowAgentLog(incoming))
    expect(store.getState().workflowRunningData!.tracing![0]!.execution_metadata).toEqual({
      ...execution_metadata,
      agent_log: [incoming.data],
    })
  },
)

it('appends messages and merges repeated message updates only into their matching node', () => {
  const first = event('m1', { metadata: { provider: 'test-provider' } })
  const other = createNodeTracing({ node_id: 'n2' })
  const { result, store } = renderWorkflowHook(useWorkflowAgentLog, {
    initialStoreState: {
      workflowRunningData: baseRunningData({
        tracing: [createNodeTracing({ node_id: 'n1' }), other],
      }),
    },
  })
  const second = event('m2')
  act(() => {
    result.current.handleWorkflowAgentLog(first)
    result.current.handleWorkflowAgentLog(second)
  })
  const updated = event('m1', { status: 'success', data: { result: 'completed' } })
  act(() => result.current.handleWorkflowAgentLog(updated))
  const traces = store.getState().workflowRunningData!.tracing!
  expect(traces[0]!.execution_metadata!.agent_log).toEqual([
    { ...first.data, ...updated.data },
    second.data,
  ])
  expect(traces[1]).toEqual(other)
})
