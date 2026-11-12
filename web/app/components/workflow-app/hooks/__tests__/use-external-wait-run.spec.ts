import type {
  WorkflowRunDetailResponse,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { act } from '@testing-library/react'
import {
  baseRunningData,
  renderWorkflowFlowHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { createDeferred } from '@/test/deferred'
import { useExternalWaitRun } from '../use-external-wait-run'

const api = vi.hoisted(() => ({
  run: vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.workflowRuns.byRunId.get
  >(),
  nodes:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflowRuns.byRunId.nodeExecutions.get
    >(),
}))
// boundary: generated Console read operations only; the workflow store and polling owner stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflowRuns.byRunId.get': api.run,
      'apps.byAppId.workflowRuns.byRunId.nodeExecutions.get': api.nodes,
    }),
  }
})

function run(status = 'paused', id = 'run-1'): WorkflowRunDetailResponse {
  return {
    id,
    status,
    inputs: {},
    outputs: status === 'succeeded' ? { answer: 'Real output' } : {},
    graph: {},
    total_tokens: null,
  }
}
function node(status = 'paused'): WorkflowRunNodeExecutionResponse {
  return {
    id: 'execution-1',
    node_id: 'external',
    node_type: 'agent',
    status,
    process_data: { external_invocation_id: 'invocation-1' },
  }
}
const initialStoreState = () => ({
  workflowRunningData: baseRunningData({
    result: { id: 'run-1', status: 'paused', external_wait: true },
  }),
})

beforeEach(({ onTestFinished }) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  api.run.mockReset().mockResolvedValue(run())
  api.nodes.mockReset().mockResolvedValue({ data: [node()] })
})

it('reads the same engine run serially through paused/running until terminal, preserving missing remote token totals', async () => {
  api.run
    .mockResolvedValueOnce(run())
    .mockResolvedValueOnce(run('running'))
    .mockResolvedValue(run('succeeded'))
  api.nodes
    .mockResolvedValueOnce({ data: [node()] })
    .mockResolvedValue({ data: [node('succeeded')] })
  const complete = vi.fn()
  const { store } = renderWorkflowFlowHook(() => useExternalWaitRun('app-1', complete), {
    initialStoreState: initialStoreState(),
  })
  await act(async () => {})
  expect(store.getState().workflowRunningData?.result.status).toBe('paused')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(store.getState().workflowRunningData?.result.status).toBe('running')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(store.getState().workflowRunningData?.result).toMatchObject({
    status: 'succeeded',
    outputs: '{"answer":"Real output"}',
  })
  expect(store.getState().workflowRunningData?.result.total_tokens).toBeUndefined()
  expect(store.getState().workflowRunningData?.tracing?.[0]?.status).toBe('succeeded')
  expect(api.run).toHaveBeenCalledTimes(3)
  expect(api.run.mock.calls.every(([input]) => input.params.run_id === 'run-1')).toBe(true)
  expect(complete).toHaveBeenCalledOnce()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
  })
  expect(api.run).toHaveBeenCalledTimes(3)
})

it('never overlaps reads and ignores late responses after stopping or changing the current run', async () => {
  const pending = createDeferred<WorkflowRunDetailResponse>()
  api.run.mockReturnValueOnce(pending.promise)
  const { store } = renderWorkflowFlowHook(() => useExternalWaitRun('app-1', vi.fn()), {
    initialStoreState: initialStoreState(),
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(api.run).toHaveBeenCalledOnce()
  expect(api.nodes).not.toHaveBeenCalled()
  act(() =>
    store
      .getState()
      .setWorkflowRunningData(
        baseRunningData({ result: { id: 'run-1', status: 'stopped', external_wait: true } }),
      ),
  )
  await act(async () => {
    pending.resolve(run('succeeded'))
  })
  expect(store.getState().workflowRunningData?.result.status).toBe('stopped')
  expect(api.nodes).not.toHaveBeenCalled()
})

it('leaves genuine human input pauses with the existing human resume owner', async () => {
  renderWorkflowFlowHook(() => useExternalWaitRun('app-1', vi.fn()), {
    initialStoreState: {
      workflowRunningData: baseRunningData({
        result: { id: 'run-1', status: 'paused', external_wait: true, human_input_wait: true },
      }),
    },
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(api.run).not.toHaveBeenCalled()
})

it('discards the prior observer immediately when a new command begins before draft saving finishes', async () => {
  const pending = createDeferred<WorkflowRunDetailResponse>()
  const snapshot = vi.fn()
  const complete = vi.fn()
  api.run.mockReturnValueOnce(pending.promise)
  const { result, store } = renderWorkflowFlowHook(
    () => useExternalWaitRun('app-1', complete, snapshot),
    { initialStoreState: initialStoreState() },
  )
  act(() => result.current())
  act(() => store.setState({ historyWorkflowData: undefined }))
  await act(async () => {
    pending.resolve(run('succeeded'))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(api.run).toHaveBeenCalledOnce()
  expect(api.nodes).not.toHaveBeenCalled()
  expect(snapshot).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
})
