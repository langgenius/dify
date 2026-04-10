import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing, NodeTracingListResponse } from '@/types/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '../../types'
import RunPanel from '../index'

const {
  mockFetchRunDetail,
  mockFetchTracingList,
  mockToastError,
} = vi.hoisted(() => ({
  mockFetchRunDetail: vi.fn(),
  mockFetchTracingList: vi.fn(),
  mockToastError: vi.fn(),
}))

const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
  fetchTracingList: (...args: unknown[]) => mockFetchTracingList(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const createRunDetail = (overrides: Partial<WorkflowRunDetailResponse> = {}): WorkflowRunDetailResponse => ({
  id: 'run-1',
  version: '1',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: '{"topic":"workflow"}',
  inputs_truncated: false,
  status: 'succeeded',
  outputs: 'workflow output',
  outputs_truncated: false,
  elapsed_time: 1.25,
  total_tokens: 24,
  total_steps: 2,
  created_by_role: 'account',
  created_by_account: {
    id: 'account-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  created_at: 1710000000,
  finished_at: 1710000001,
  ...overrides,
})

const createTracingNode = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Trace Node',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  elapsed_time: 0.5,
  execution_metadata: {
    total_tokens: 12,
    total_price: 0,
    currency: 'USD',
  },
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 1710000000,
  created_by: {
    id: 'account-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 1710000001,
  ...overrides,
})

describe('RunPanel', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchRunDetail.mockResolvedValue(createRunDetail())
    mockFetchTracingList.mockResolvedValue({
      data: [createTracingNode()],
    } satisfies NodeTracingListResponse)
  })

  afterAll(() => {
    if (originalClientHeightDescriptor)
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeightDescriptor)
  })

  it('loads run detail and tracing data on mount, then renders the result tab', async () => {
    const handleResult = vi.fn()
    const runDetail = createRunDetail()
    mockFetchRunDetail.mockResolvedValue(runDetail)

    renderWorkflowComponent(
      <RunPanel
        runDetailUrl="/console/api/runs/run-1"
        tracingListUrl="/console/api/runs/run-1/tracing"
        getResultCallback={handleResult}
      />,
    )

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/console/api/runs/run-1')
      expect(mockFetchTracingList).toHaveBeenCalledWith({
        url: '/console/api/runs/run-1/tracing',
      })
      expect(handleResult).toHaveBeenCalledWith(runDetail)
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain('workflow output')
    })
  })

  it('switches between detail, tracing, and result tabs with real child panels', async () => {
    renderWorkflowComponent(
      <RunPanel
        activeTab="RESULT"
        runDetailUrl="/console/api/runs/run-2"
        tracingListUrl="/console/api/runs/run-2/tracing"
      />,
      {
        initialStoreState: {
          isListening: true,
        },
      },
    )

    await waitFor(() => {
      expect(screen.getAllByText('SUCCESS').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByText('runLog.tracing'))

    await waitFor(() => {
      expect(screen.getByText('Trace Node')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('runLog.result'))

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledTimes(2)
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain('workflow output')
    })
  })

  it('reports run-detail and tracing failures through toast.error', async () => {
    mockFetchRunDetail.mockRejectedValueOnce(new Error('detail boom'))
    mockFetchTracingList.mockRejectedValueOnce(new Error('tracing boom'))

    renderWorkflowComponent(
      <RunPanel
        runDetailUrl="/console/api/runs/run-3"
        tracingListUrl="/console/api/runs/run-3/tracing"
      />,
    )

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Error: detail boom')
      expect(mockToastError).toHaveBeenCalledWith('Error: tracing boom')
    })
  })
})
