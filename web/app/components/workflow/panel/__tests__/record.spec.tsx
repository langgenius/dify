import type { WorkflowRunDetailResponse } from '@/models/log'
import { act, screen } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import Record from '../record'

const mockHandleUpdateWorkflowCanvas = vi.fn()

let latestGetResultCallback: ((res: WorkflowRunDetailResponse) => void) | undefined

vi.mock('../../hooks/use-workflow-update', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow-update')>()

  return {
    ...actual,
    useWorkflowUpdate: () => ({
      handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
    }),
  }
})

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

const createRunDetail = (
  overrides: Partial<WorkflowRunDetailResponse> = {},
): WorkflowRunDetailResponse => ({
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
          finished_at: 1_700_000_000,
        },
      },
      hooksStoreProps: {
        getWorkflowRunAndTraceUrl,
      },
    })

    expect(screen.getByText(/Test Run \(\d{2}:\d{2}:\d{2}( [AP]M)?\)/)).toBeInTheDocument()
    expect(screen.getByTestId('run')).toHaveAttribute('data-run-detail-url', '/runs/run-1')
    expect(screen.getByTestId('run')).toHaveAttribute('data-tracing-list-url', '/traces/run-1')
    expect(getWorkflowRunAndTraceUrl).toHaveBeenCalledTimes(2)
    expect(getWorkflowRunAndTraceUrl).toHaveBeenNthCalledWith(1, 'run-1')
    expect(getWorkflowRunAndTraceUrl).toHaveBeenNthCalledWith(2, 'run-1')
  })

  it('renders paused history without a finished timestamp', () => {
    renderWorkflowComponent(<Record />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'paused',
        },
      },
    })

    expect(screen.getByText('Test Run (Paused)')).toBeInTheDocument()
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
      latestGetResultCallback?.(
        createRunDetail({
          graph: {
            nodes,
            edges,
          },
        }),
      )
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
      latestGetResultCallback?.(
        createRunDetail({
          graph: {
            nodes,
            edges,
            viewport,
          },
        }),
      )
    })

    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
      nodes,
      edges,
      viewport,
    })
  })
})
