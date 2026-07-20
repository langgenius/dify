import type { AgentLogResponse } from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowAgentLog } from '../use-workflow-agent-log'

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFilesInLogs: vi.fn(() => []),
}))

describe('useWorkflowAgentLog', () => {
  it('creates agent_log when execution_metadata has none', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n1', execution_metadata: {} }],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_id: 'n1', message_id: 'm1' },
    } as AgentLogResponse)

    const trace = store.getState().workflowRunningData!.tracing![0]
    expect(trace!.execution_metadata!.agent_log).toHaveLength(1)
    expect(trace!.execution_metadata!.agent_log![0]!.message_id).toBe('m1')
  })

  it('appends to existing agent_log', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            {
              node_id: 'n1',
              execution_metadata: { agent_log: [{ message_id: 'm1', text: 'log1' }] },
            },
          ],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_id: 'n1', message_id: 'm2' },
    } as AgentLogResponse)

    expect(
      store.getState().workflowRunningData!.tracing![0]!.execution_metadata!.agent_log,
    ).toHaveLength(2)
  })

  it('updates an existing log entry by message_id', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            {
              node_id: 'n1',
              execution_metadata: { agent_log: [{ message_id: 'm1', text: 'old' }] },
            },
          ],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_id: 'n1', message_id: 'm1', text: 'new' },
    } as unknown as AgentLogResponse)

    const log = store.getState().workflowRunningData!.tracing![0]!.execution_metadata!.agent_log!
    expect(log).toHaveLength(1)
    expect((log[0] as unknown as { text: string }).text).toBe('new')
  })

  it('creates execution_metadata when it does not exist', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{ node_id: 'n1' }],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_id: 'n1', message_id: 'm1' },
    } as AgentLogResponse)

    expect(
      store.getState().workflowRunningData!.tracing![0]!.execution_metadata!.agent_log,
    ).toHaveLength(1)
  })

  it('routes agent log to the exact trace entry by node_execution_id, not the first node_id match', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [
            { id: 'exec-1', node_id: 'n1', execution_metadata: {} },
            { id: 'exec-2', node_id: 'n1', execution_metadata: {} },
          ],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_execution_id: 'exec-2', node_id: 'n1', message_id: 'm1' },
    } as AgentLogResponse)

    const tracing = store.getState().workflowRunningData!.tracing!
    // exec-1 must not receive the log
    expect(tracing[0]!.execution_metadata!.agent_log).toBeUndefined()
    // exec-2 must receive it
    expect(tracing[1]!.execution_metadata!.agent_log).toHaveLength(1)
    expect(tracing[1]!.execution_metadata!.agent_log![0]!.message_id).toBe('m1')
  })
})
