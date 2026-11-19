import type { AgentLogResponse, AgentLogStreamData } from '@/types/workflow'
import { act } from '@testing-library/react'
import { createNodeTracing } from '../../../__tests__/fixtures'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowAgentLog } from '../use-workflow-agent-log'

const event = (id: string, overrides: Partial<AgentLogStreamData> = {}): AgentLogResponse => ({
  task_id: 'task-1',
  event: 'agent_log',
  data: {
    node_execution_id: 'execution-1',
    node_id: 'n1',
    id,
    label: 'Tool call',
    data: { result: 'initial' },
    status: 'start',
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
      agent_log: [
        {
          node_execution_id: 'execution-1',
          message_id: 'm1',
          node_id: 'n1',
          label: 'Tool call',
          data: { result: 'initial' },
          status: 'start',
        },
      ],
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
    {
      node_execution_id: 'execution-1',
      message_id: 'm1',
      node_id: 'n1',
      label: 'Tool call',
      data: { result: 'completed' },
      status: 'success',
    },
    {
      node_execution_id: 'execution-1',
      message_id: 'm2',
      node_id: 'n1',
      label: 'Tool call',
      data: { result: 'initial' },
      status: 'start',
    },
  ])
  expect(traces[1]).toEqual(other)
})

it('skips Agent v2 tool snapshots so they never enter node tracing', () => {
  const tracing = createNodeTracing({ node_id: 'n1' })
  const { result, store } = renderWorkflowHook(useWorkflowAgentLog, {
    initialStoreState: {
      workflowRunningData: baseRunningData({ tracing: [tracing] }),
    },
  })
  act(() =>
    result.current.handleWorkflowAgentLog(
      event('tool-1', {
        metadata: { agent_node_version: '2', kind: 'tool' },
        data: { tool_name: 'shell_run', tool_call_id: 'call-1' },
      }),
    ),
  )
  const traces = store.getState().workflowRunningData!.tracing!
  expect(traces).toHaveLength(1)
  expect(traces[0]!.execution_metadata?.agent_log).toBeUndefined()
})
