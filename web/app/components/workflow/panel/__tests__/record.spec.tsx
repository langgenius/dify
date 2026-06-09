import type { WorkflowRunDetailResponse } from '@/models/log'
import { act, screen } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import Record from '../record'

const mockHandleUpdateWorkflowCanvas = vi.fn()
const mockFormatWorkflowRunIdentifier = vi.fn((finishedAt?: number) => finishedAt ? ' (Finished)' : ' (Running)')

let latestGetResultCallback: ((res: WorkflowRunDetailResponse) => void) | undefined

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

vi.mock('@/app/components/workflow/run', () => ({
  default: ({
    runDetailUrl,
    tracingListUrl,
    getResultCallback,
  }: {
    runDetailUrl: string
    tracingListUrl: string
    getResultCallback: (res: WorkflowRunDetailResponse) => void
  }) => {
    latestGetResultCallback = getResultCallback
    return (
      <div
        data-run-detail-url={runDetailUrl}
        data-testid="run"
        data-tracing-list-url={tracingListUrl}
      />
    )
  },
}))

vi.mock('@/app/components/workflow/utils', () => ({
  formatWorkflowRunIdentifier: (finishedAt?: number) => mockFormatWorkflowRunIdentifier(finishedAt),
}))

const createRunDetail = (overrides: Partial<WorkflowRunDetailResponse> = {}): WorkflowRunDetailResponse => ({
  id: 'run-1',
  version: '1',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: '{}',
  inputs_truncated: false,
  status: 'succeeded',
  outputs: '{}',
  outputs_truncated: false,
  total_steps: 1,
  created_by_role: 'account',
  created_at: 1,
  finished_at: 2,
  ...overrides,
})

describe('Record', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestGetResultCallback = undefined
  })

  it('renders the run title and passes run and trace URLs to the run panel', () => {
    const getWorkflowRunAndTraceUrl = vi.fn((runId?: string) => ({
      runUrl: `/runs/${runId}`,
      traceUrl: `/traces/${runId}`,
    }))

    renderWorkflowComponent(<Record />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'succeeded',
          finished_at: 1700000000000,
        },
      },
      hooksStoreProps: {
        getWorkflowRunAndTraceUrl,
      },
    })

    expect(screen.getByText('Test Run (Finished)')).toBeInTheDocument()
    expect(screen.getByTestId('run')).toHaveAttribute('data-run-detail-url', '/runs/run-1')
    expect(screen.getByTestId('run')).toHaveAttribute('data-tracing-list-url', '/traces/run-1')
    expect(getWorkflowRunAndTraceUrl).toHaveBeenCalledTimes(2)
    expect(getWorkflowRunAndTraceUrl).toHaveBeenNthCalledWith(1, 'run-1')
    expect(getWorkflowRunAndTraceUrl).toHaveBeenNthCalledWith(2, 'run-1')
    expect(mockFormatWorkflowRunIdentifier).toHaveBeenCalledWith(1700000000000)
  })

  it('updates the workflow canvas with a fallback viewport when the response omits one', () => {
    const nodes = [createNode({ id: 'node-1' })]
    const edges = [createEdge({ id: 'edge-1' })]

    renderWorkflowComponent(<Record />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'succeeded',
        },
      },
      hooksStoreProps: {
        getWorkflowRunAndTraceUrl: () => ({ runUrl: '/runs/run-1', traceUrl: '/traces/run-1' }),
      },
    })

    expect(latestGetResultCallback).toBeDefined()

    act(() => {
      latestGetResultCallback?.(createRunDetail({
        graph: {
          nodes,
          edges,
        },
      }))
    })

    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  })

  it('uses the response viewport when one is available', () => {
    const nodes = [createNode({ id: 'node-1' })]
    const edges = [createEdge({ id: 'edge-1' })]
    const viewport = { x: 12, y: 24, zoom: 0.75 }

    renderWorkflowComponent(<Record />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'succeeded',
        },
      },
      hooksStoreProps: {
        getWorkflowRunAndTraceUrl: () => ({ runUrl: '/runs/run-1', traceUrl: '/traces/run-1' }),
      },
    })

    act(() => {
      latestGetResultCallback?.(createRunDetail({
        graph: {
          nodes,
          edges,
          viewport,
        },
      }))
    })

    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
      nodes,
      edges,
      viewport,
    })
  })
})
