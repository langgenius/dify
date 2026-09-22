import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing, NodeTracingListResponse } from '@/types/workflow'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '../../types'
import RunPanel from '../index'

const { mockFetchRunDetail, mockFetchTracingList, mockToastError } = vi.hoisted(() => ({
  mockFetchRunDetail: vi.fn(),
  mockFetchTracingList: vi.fn(),
  mockToastError: vi.fn(),
}))

const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientHeight',
)

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
  fetchTracingList: (...args: unknown[]) => mockFetchTracingList(...args),
}))

vi.mock('@/app/notifications', async (importOriginal) => ({
  ...(await importOriginal()),
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
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
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
        'workflow output',
      )
    })
  })

  it('switches between detail, tracing, and result tabs with real child panels', async () => {
    const user = userEvent.setup()
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

    expect(screen.getByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))

    await waitFor(() => {
      expect(screen.getByText('Trace Node')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledTimes(2)
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
        'workflow output',
      )
    })
  })

  it('lets keyboard users switch the logs detail and tracing panels when result is hidden', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(
      <RunPanel
        hideResult
        activeTab="DETAIL"
        runDetailUrl="/console/api/runs/run-1"
        tracingListUrl="/console/api/runs/run-1/tracing"
      />,
    )

    const detailPanel = await screen.findByRole('tabpanel', { name: 'runLog.detail' })
    await waitFor(() =>
      expect(within(detailPanel).getAllByText('SUCCESS').length).toBeGreaterThan(0),
    )
    expect(screen.queryByRole('tab', { name: 'runLog.result' })).not.toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('tab', { name: 'runLog.detail' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')

    const tracingTab = screen.getByRole('tab', { name: 'runLog.tracing' })
    expect(tracingTab).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(tracingTab).toHaveAttribute('aria-selected', 'true')
    const tracingPanel = screen.getByRole('tabpanel', { name: 'runLog.tracing' })
    expect(tracingTab).toHaveAttribute('aria-controls', tracingPanel.id)
    expect(within(tracingPanel).getByText('Trace Node')).toBeInTheDocument()
    expect(screen.queryByRole('tabpanel', { name: 'runLog.detail' })).not.toBeInTheDocument()
    await waitFor(() => expect(mockFetchTracingList).toHaveBeenCalledTimes(2))
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

  it.each(['RESULT', 'DETAIL', 'TRACING'] as const)(
    'refreshes data when the already selected %s tab is clicked',
    async (activeTab) => {
      const user = userEvent.setup()
      renderWorkflowComponent(
        <RunPanel
          activeTab={activeTab}
          runDetailUrl="/console/api/runs/run-1"
          tracingListUrl="/console/api/runs/run-1/tracing"
        />,
      )

      await waitFor(() => expect(mockFetchTracingList).toHaveBeenCalledTimes(1))
      await user.click(screen.getByRole('tab', { name: `runLog.${activeTab.toLowerCase()}` }))

      await waitFor(() => expect(mockFetchTracingList).toHaveBeenCalledTimes(2))
      expect(mockFetchRunDetail).toHaveBeenCalledTimes(activeTab === 'RESULT' ? 2 : 1)
    },
  )
})
