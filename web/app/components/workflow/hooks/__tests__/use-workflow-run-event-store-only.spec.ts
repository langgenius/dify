import type {
  AgentLogResponse,
  HumanInputFormFilledResponse,
  HumanInputFormTimeoutResponse,
  TextChunkResponse,
  TextReplaceResponse,
  WorkflowFinishedResponse,
} from '@/types/workflow'
import { baseRunningData, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import { useWorkflowAgentLog } from '../use-workflow-run-event/use-workflow-agent-log'
import { useWorkflowFailed } from '../use-workflow-run-event/use-workflow-failed'
import { useWorkflowFinished } from '../use-workflow-run-event/use-workflow-finished'
import { useWorkflowNodeHumanInputFormFilled } from '../use-workflow-run-event/use-workflow-node-human-input-form-filled'
import { useWorkflowNodeHumanInputFormTimeout } from '../use-workflow-run-event/use-workflow-node-human-input-form-timeout'
import { useWorkflowPaused } from '../use-workflow-run-event/use-workflow-paused'
import { useWorkflowTextChunk } from '../use-workflow-run-event/use-workflow-text-chunk'
import { useWorkflowTextReplace } from '../use-workflow-run-event/use-workflow-text-replace'

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFilesInLogs: vi.fn(() => []),
}))

describe('useWorkflowFailed', () => {
  it('should set status to Failed', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFailed(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFailed()

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Failed)
  })
})

describe('useWorkflowPaused', () => {
  it('should set status to Paused', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowPaused(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowPaused()

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Paused)
  })
})

describe('useWorkflowTextChunk', () => {
  it('should append text and activate result tab', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextChunk(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'Hello' }),
      },
    })

    result.current.handleWorkflowTextChunk({ data: { text: ' World' } } as TextChunkResponse)

    const state = store.getState().workflowRunningData!
    expect(state.resultText).toBe('Hello World')
    expect(state.resultTabActive).toBe(true)
  })
})

describe('useWorkflowTextReplace', () => {
  it('should replace resultText', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowTextReplace(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({ resultText: 'old text' }),
      },
    })

    result.current.handleWorkflowTextReplace({ data: { text: 'new text' } } as TextReplaceResponse)

    expect(store.getState().workflowRunningData!.resultText).toBe('new text')
  })
})

describe('useWorkflowFinished', () => {
  it('should merge data into result and activate result tab for single string output', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { answer: 'hello' } },
    } as WorkflowFinishedResponse)

    const state = store.getState().workflowRunningData!
    expect(state.result.status).toBe('succeeded')
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('hello')
  })

  it('should not activate result tab for multi-key outputs', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowFinished(), {
      initialStoreState: { workflowRunningData: baseRunningData() },
    })

    result.current.handleWorkflowFinished({
      data: { status: 'succeeded', outputs: { a: 'hello', b: 'world' } },
    } as WorkflowFinishedResponse)

    expect(store.getState().workflowRunningData!.resultTabActive).toBeFalsy()
  })
})

describe('useWorkflowAgentLog', () => {
  it('should create agent_log array when execution_metadata has no agent_log', () => {
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
    expect(trace.execution_metadata!.agent_log).toHaveLength(1)
    expect(trace.execution_metadata!.agent_log![0].message_id).toBe('m1')
  })

  it('should append to existing agent_log', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{
            node_id: 'n1',
            execution_metadata: { agent_log: [{ message_id: 'm1', text: 'log1' }] },
          }],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_id: 'n1', message_id: 'm2' },
    } as AgentLogResponse)

    expect(store.getState().workflowRunningData!.tracing![0].execution_metadata!.agent_log).toHaveLength(2)
  })

  it('should update existing log entry by message_id', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowAgentLog(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          tracing: [{
            node_id: 'n1',
            execution_metadata: { agent_log: [{ message_id: 'm1', text: 'old' }] },
          }],
        }),
      },
    })

    result.current.handleWorkflowAgentLog({
      data: { node_id: 'n1', message_id: 'm1', text: 'new' },
    } as unknown as AgentLogResponse)

    const log = store.getState().workflowRunningData!.tracing![0].execution_metadata!.agent_log!
    expect(log).toHaveLength(1)
    expect((log[0] as unknown as { text: string }).text).toBe('new')
  })

  it('should create execution_metadata when it does not exist', () => {
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

    expect(store.getState().workflowRunningData!.tracing![0].execution_metadata!.agent_log).toHaveLength(1)
  })
})

describe('useWorkflowNodeHumanInputFormFilled', () => {
  it('should remove form from humanInputFormDataList and add to humanInputFilledFormDataList', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputFormFilled(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '' },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputFormFilled({
      data: { node_id: 'n1', node_title: 'Node 1', rendered_content: 'done' },
    } as HumanInputFormFilledResponse)

    const state = store.getState().workflowRunningData!
    expect(state.humanInputFormDataList).toHaveLength(0)
    expect(state.humanInputFilledFormDataList).toHaveLength(1)
    expect(state.humanInputFilledFormDataList![0].node_id).toBe('n1')
  })

  it('should create humanInputFilledFormDataList when it does not exist', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputFormFilled(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '' },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputFormFilled({
      data: { node_id: 'n1', node_title: 'Node 1', rendered_content: 'done' },
    } as HumanInputFormFilledResponse)

    expect(store.getState().workflowRunningData!.humanInputFilledFormDataList).toBeDefined()
  })
})

describe('useWorkflowNodeHumanInputFormTimeout', () => {
  it('should set expiration_time on the matching form', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowNodeHumanInputFormTimeout(), {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          humanInputFormDataList: [
            { node_id: 'n1', form_id: 'f1', node_title: 'Node 1', form_content: '', expiration_time: 0 },
          ],
        }),
      },
    })

    result.current.handleWorkflowNodeHumanInputFormTimeout({
      data: { node_id: 'n1', node_title: 'Node 1', expiration_time: 1000 },
    } as HumanInputFormTimeoutResponse)

    expect(store.getState().workflowRunningData!.humanInputFormDataList![0].expiration_time).toBe(1000)
  })
})
