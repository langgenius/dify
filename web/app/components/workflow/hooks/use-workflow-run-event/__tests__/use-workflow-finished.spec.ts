import type { ReactNode } from 'react'
import type { NodeTracing, WorkflowFinishedResponse } from '@/types/workflow'
import { toast } from '@langgenius/dify-ui/toast'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { useEdges, useNodes } from 'reactflow'
import { WorkflowContext } from '@/app/components/workflow/context'
import { fetchTracingList } from '@/service/log'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import {
  baseRunningData,
  createTestWorkflowStore,
  renderWorkflowFlowHook,
} from '../../../__tests__/workflow-test-env'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../../types'
import { useFailedWorkflowRunReconciliation, useWorkflowFinished } from '../use-workflow-finished'

vi.mock('@/service/log', () => ({
  fetchTracingList: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const mockFetchTracingList = vi.mocked(fetchTracingList)
const mockToastError = vi.mocked(toast.error)

const staleTracing = [
  {
    id: 'source-execution',
    index: 1,
    node_id: 'source-node',
    title: 'Fail Fast Call',
    status: NodeRunningStatus.Failed,
    error: 'source failed',
  },
  {
    id: 'slow-execution-a',
    index: 2,
    node_id: 'slow-node-a',
    title: 'Slow LLM Call',
    status: NodeRunningStatus.Running,
  },
  {
    id: 'slow-execution-b',
    index: 3,
    node_id: 'slow-node-b',
    title: 'Slow LLM Call (1)',
    status: NodeRunningStatus.Running,
  },
] as NodeTracing[]

const persistedTracing = [
  staleTracing[0],
  {
    ...staleTracing[1],
    status: NodeRunningStatus.Failed,
    error: 'graph failed',
    execution_metadata: {
      failure_source: {
        node_execution_id: 'source-execution',
        node_id: 'source-node',
        node_title: 'Fail Fast Call',
      },
    },
  },
  {
    ...staleTracing[2],
    status: NodeRunningStatus.Failed,
    error: 'graph failed',
    execution_metadata: {
      failure_source: {
        node_execution_id: 'source-execution',
        node_id: 'source-node',
        node_title: 'Fail Fast Call',
      },
    },
  },
] as NodeTracing[]

const getWorkflowRunAndTraceUrl = vi.fn((runId?: string) => ({
  runUrl: `/runs/${runId}`,
  traceUrl: `/runs/${runId}/node-executions`,
}))

function renderFinishedHook() {
  const store = createTestWorkflowStore({
    workflowRunningData: baseRunningData({
      result: {
        id: 'run-1',
        status: WorkflowRunningStatus.Running,
      },
      tracing: staleTracing,
    }),
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(WorkflowContext.Provider, { value: store }, children)

  return {
    ...renderHook(() => useWorkflowFinished(), { wrapper }),
    store,
  }
}

function renderReconciliationHook() {
  return renderWorkflowFlowHook(
    () => {
      useFailedWorkflowRunReconciliation()
      return {
        nodes: useNodes(),
        edges: useEdges(),
      }
    },
    {
      nodes: [
        createNode({
          id: 'source-node',
          data: { _runningStatus: NodeRunningStatus.Failed },
        }),
        createNode({
          id: 'slow-node-a',
          data: { _runningStatus: NodeRunningStatus.Running },
        }),
        createNode({
          id: 'slow-node-b',
          data: { _runningStatus: NodeRunningStatus.Running },
        }),
      ],
      edges: [
        createEdge({
          id: 'edge-a',
          source: 'source-node',
          target: 'slow-node-a',
          data: { _targetRunningStatus: NodeRunningStatus.Running },
        }),
        createEdge({
          id: 'edge-b',
          source: 'source-node',
          target: 'slow-node-b',
          data: { _targetRunningStatus: NodeRunningStatus.Running },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: {
            id: 'run-1',
            status: WorkflowRunningStatus.Running,
          },
          tracing: staleTracing,
        }),
      },
      hooksStoreProps: {
        getWorkflowRunAndTraceUrl,
      },
    },
  )
}

function workflowFinished(
  status: WorkflowRunningStatus,
  outputs: Record<string, string> = {},
  runId = 'run-1',
): WorkflowFinishedResponse {
  return {
    data: {
      id: runId,
      status,
      outputs,
      error: status === WorkflowRunningStatus.Failed ? 'graph failed' : undefined,
    },
  } as WorkflowFinishedResponse
}

describe('useWorkflowFinished', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes and records a failed result without a hooks-store provider', () => {
    const { result, store } = renderFinishedHook()

    act(() => {
      result.current.handleWorkflowFinished(workflowFinished(WorkflowRunningStatus.Failed))
    })

    expect(store.getState().workflowRunningData!.result.status).toBe(WorkflowRunningStatus.Failed)
    expect(mockFetchTracingList).not.toHaveBeenCalled()
  })

  it('merges successful data and activates the result tab for a string output', () => {
    const { result, store } = renderFinishedHook()

    act(() => {
      result.current.handleWorkflowFinished(
        workflowFinished(WorkflowRunningStatus.Succeeded, { answer: 'hello' }),
      )
    })

    const state = store.getState().workflowRunningData!
    expect(state.result.status).toBe(WorkflowRunningStatus.Succeeded)
    expect(state.resultTabActive).toBe(true)
    expect(state.resultText).toBe('hello')
    expect(mockFetchTracingList).not.toHaveBeenCalled()
  })

  it('does not activate the result tab for multi-key outputs', () => {
    const { result, store } = renderFinishedHook()

    act(() => {
      result.current.handleWorkflowFinished(
        workflowFinished(WorkflowRunningStatus.Succeeded, { a: 'hello', b: 'world' }),
      )
    })

    const state = store.getState().workflowRunningData!
    expect(state.resultTabActive).toBe(false)
    expect(state.resultText).toBe('')
  })
})

describe('useFailedWorkflowRunReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reconciles failed tracing and canvas state from persisted executions once', async () => {
    mockFetchTracingList.mockResolvedValue({ data: persistedTracing })
    const { result, store } = renderReconciliationHook()

    act(() => {
      store.getState().setWorkflowRunningData(
        baseRunningData({
          result: { id: 'run-1', status: WorkflowRunningStatus.Failed },
          tracing: staleTracing,
        }),
      )
    })

    await waitFor(() => {
      expect(mockFetchTracingList).toHaveBeenCalledWith({
        url: '/runs/run-1/node-executions',
      })
      expect(store.getState().workflowRunningData!.tracing).toEqual(persistedTracing)
      expect(result.current.nodes.find((node) => node.id === 'slow-node-a')!.data).toMatchObject({
        _runningStatus: NodeRunningStatus.Failed,
      })
      expect(result.current.nodes.find((node) => node.id === 'slow-node-b')!.data).toMatchObject({
        _runningStatus: NodeRunningStatus.Failed,
      })
      expect(result.current.edges.find((edge) => edge.id === 'edge-a')!.data).toMatchObject({
        _targetRunningStatus: NodeRunningStatus.Failed,
      })
      expect(result.current.edges.find((edge) => edge.id === 'edge-b')!.data).toMatchObject({
        _targetRunningStatus: NodeRunningStatus.Failed,
      })
    })

    expect(mockFetchTracingList).toHaveBeenCalledTimes(1)
    expect(
      store.getState().workflowRunningData!.tracing![1]!.execution_metadata?.failure_source,
    ).toEqual({
      node_execution_id: 'source-execution',
      node_id: 'source-node',
      node_title: 'Fail Fast Call',
    })
  })

  it('ignores a reconciliation response after a newer run starts', async () => {
    let resolveTracing: ((value: { data: NodeTracing[] }) => void) | undefined
    mockFetchTracingList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTracing = resolve
        }),
    )
    const { store } = renderReconciliationHook()

    act(() => {
      store.getState().setWorkflowRunningData(
        baseRunningData({
          result: { id: 'run-1', status: WorkflowRunningStatus.Failed },
          tracing: staleTracing,
        }),
      )
    })
    await waitFor(() => {
      expect(mockFetchTracingList).toHaveBeenCalledTimes(1)
    })

    const newRunTracing = [{ ...staleTracing[1], id: 'new-execution' }] as NodeTracing[]
    act(() => {
      store.getState().setWorkflowRunningData(
        baseRunningData({
          result: { id: 'run-2', status: WorkflowRunningStatus.Running },
          tracing: newRunTracing,
        }),
      )
    })
    await act(async () => {
      resolveTracing!({ data: persistedTracing })
    })

    expect(store.getState().workflowRunningData!.tracing).toEqual(newRunTracing)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('keeps stale tracing and reports an active run reconciliation failure', async () => {
    mockFetchTracingList.mockRejectedValue(new Error('trace refresh failed'))
    const { store } = renderReconciliationHook()

    act(() => {
      store.getState().setWorkflowRunningData(
        baseRunningData({
          result: { id: 'run-1', status: WorkflowRunningStatus.Failed },
          tracing: staleTracing,
        }),
      )
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Error: trace refresh failed')
    })
    expect(store.getState().workflowRunningData!.tracing).toEqual(staleTracing)
  })
})
