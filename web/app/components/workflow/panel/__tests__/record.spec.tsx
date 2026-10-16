import type { WorkflowRunDetailResponse } from '@/models/log'
import type { WorkflowRunOwner } from '@/service/log'
import { act, screen } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import Record from '../record'

const mockHandleUpdateWorkflowCanvas = vi.fn()
const mockFormatWorkflowRunIdentifier = vi.fn((finishedAt?: number) =>
  finishedAt ? ' (Finished)' : ' (Running)',
)

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
    owner,
    runId,
    getResultCallback,
  }: {
    owner: WorkflowRunOwner
    runId?: string
    getResultCallback: (res: WorkflowRunDetailResponse) => void
  }) => {
    latestGetResultCallback = getResultCallback
    return <div data-owner={JSON.stringify(owner)} data-run-id={runId} data-testid="run" />
  },
}))

vi.mock('@/app/components/workflow/utils', () => ({
  formatWorkflowRunIdentifier: (finishedAt?: number) => mockFormatWorkflowRunIdentifier(finishedAt),
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
  inputs: {},
  status: 'succeeded',
  outputs: {},
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

  it('renders the run title and passes the editor resource and run id to the run panel', () => {
    renderWorkflowComponent(<Record />, {
      initialStoreState: {
        historyWorkflowData: {
          id: 'run-1',
          status: 'succeeded',
          finished_at: 1700000000000,
        },
      },
    })

    expect(screen.getByText('Test Run (Finished)')).toBeInTheDocument()
    expect(screen.getByTestId('run')).toHaveAttribute(
      'data-owner',
      JSON.stringify({ kind: 'app', appId: 'app-1', mode: 'workflow' }),
    )
    expect(screen.getByTestId('run')).toHaveAttribute('data-run-id', 'run-1')
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
