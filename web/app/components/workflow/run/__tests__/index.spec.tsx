import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing, NodeTracingListResponse } from '@/types/workflow'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '../../types'
import RunPanel from '../index'

const { mockFetchRunDetail, mockFetchTracingList, mockToastError, mockRequest } = vi.hoisted(
  () => ({
    mockFetchRunDetail: vi.fn(),
    mockFetchTracingList: vi.fn(),
    mockToastError: vi.fn(),
    mockRequest: vi.fn(),
  }),
)

const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientHeight',
)

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
  fetchTracingList: (...args: unknown[]) => mockFetchTracingList(...args),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mockRequest,
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
      expect(screen.getAllByText('appLog.status.succeeded').length).toBeGreaterThan(0)
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
      expect(within(detailPanel).getAllByText('appLog.status.succeeded').length).toBeGreaterThan(0),
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

  it('loads nested workflow-tool executions for the inspected app and run', async () => {
    const user = userEvent.setup()
    mockFetchTracingList.mockResolvedValue({
      data: [
        createTracingNode({
          node_type: BlockEnum.Tool,
          expand: true,
          extras: { workflow_tool: true, icon: { content: '✅', background: '#fff' } },
        }),
      ],
    } satisfies NodeTracingListResponse)
    mockRequest.mockResolvedValue(Response.json({ data: [] }))

    renderWorkflowComponent(
      <RunPanel
        appId="inspected-app"
        activeTab="TRACING"
        runDetailUrl="/apps/inspected-app/workflow-runs/run-1"
        tracingListUrl="/apps/inspected-app/workflow-runs/run-1/node-executions"
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'runLog.tracing' }))
    await screen.findByText('common.noData')
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining(
        '/apps/inspected-app/workflow-runs/run-1/node-executions/trace-1/children',
      ),
      expect.anything(),
      expect.anything(),
    )
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
  it('keeps the new record and selected tab when an old detail response arrives late', async () => {
    const user = userEvent.setup()
    const handleResult = vi.fn()
    let resolveOldResponse: (detail: WorkflowRunDetailResponse) => void = () => {}
    mockFetchRunDetail
      .mockReturnValueOnce(
        new Promise<WorkflowRunDetailResponse>((resolve) => {
          resolveOldResponse = resolve
        }),
      )
      .mockResolvedValue(createRunDetail({ id: 'new-run', outputs: 'New result' }))
    const { rerender } = renderWorkflowComponent(
      <RunPanel
        runDetailUrl="/runs/old-run"
        tracingListUrl="/runs/old-run/tracing"
        getResultCallback={handleResult}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
    rerender(
      <RunPanel
        runDetailUrl="/runs/new-run"
        tracingListUrl="/runs/new-run/tracing"
        getResultCallback={handleResult}
      />,
    )
    expect(screen.getByRole('tab', { name: 'runLog.tracing' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await screen.findByText('Trace Node')
    await act(async () => {
      resolveOldResponse(createRunDetail({ id: 'old-run', outputs: 'Old result' }))
    })
    expect(handleResult).toHaveBeenCalledTimes(1)
    expect(handleResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-run' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    expect(((await screen.findByTestId('monaco-editor')) as HTMLTextAreaElement).value).toContain(
      'New result',
    )
  })

  it('clears the previous result while the destination record is loading and ignores old failures', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWorkflowComponent(
      <RunPanel runDetailUrl="/runs/first" tracingListUrl="/runs/first/tracing" />,
    )
    await screen.findByTestId('monaco-editor')
    let rejectRefresh: (error: Error) => void = () => {}
    mockFetchRunDetail
      .mockReturnValueOnce(
        new Promise<WorkflowRunDetailResponse>((_, reject) => {
          rejectRefresh = reject
        }),
      )
      .mockResolvedValue(createRunDetail({ id: 'next', outputs: 'Next result' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    rerender(<RunPanel runDetailUrl="/runs/next" tracingListUrl="/runs/next/tracing" />)
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
    await screen.findByTestId('monaco-editor')
    await act(async () => {
      rejectRefresh(new Error('Old refresh failed'))
    })
    expect(mockToastError).not.toHaveBeenCalled()
    expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
      'Next result',
    )
  })

  it('ignores tracing that completes after its record has been replaced', async () => {
    let resolveOldTrace: (value: NodeTracingListResponse) => void = () => {}
    mockFetchTracingList
      .mockReturnValueOnce(
        new Promise<NodeTracingListResponse>((resolve) => {
          resolveOldTrace = resolve
        }),
      )
      .mockResolvedValue({ data: [createTracingNode({ title: 'New trace' })] })
    const { rerender } = renderWorkflowComponent(
      <RunPanel activeTab="TRACING" runDetailUrl="/runs/old" tracingListUrl="/runs/old/tracing" />,
    )
    await waitFor(() => expect(mockFetchTracingList).toHaveBeenCalledTimes(1))
    rerender(
      <RunPanel activeTab="TRACING" runDetailUrl="/runs/new" tracingListUrl="/runs/new/tracing" />,
    )
    await screen.findByText('New trace')
    await act(async () => {
      resolveOldTrace({ data: [createTracingNode({ title: 'Old trace' })] })
    })
    expect(screen.getByText('New trace')).toBeInTheDocument()
    expect(screen.queryByText('Old trace')).not.toBeInTheDocument()
  })
  it('does not restart the record request when its result callback changes', async () => {
    const user = userEvent.setup()
    const firstCallback = vi.fn()
    const nextCallback = vi.fn()
    const { rerender } = renderWorkflowComponent(
      <RunPanel
        runDetailUrl="/runs/record"
        tracingListUrl="/runs/record/tracing"
        getResultCallback={firstCallback}
      />,
    )
    await screen.findByTestId('monaco-editor')
    rerender(
      <RunPanel
        runDetailUrl="/runs/record"
        tracingListUrl="/runs/record/tracing"
        getResultCallback={nextCallback}
      />,
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(mockFetchRunDetail).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await waitFor(() => expect(nextCallback).toHaveBeenCalledTimes(1))
    expect(firstCallback).toHaveBeenCalledTimes(1)
  })
  it('keeps the latest refresh when requests for the same record resolve out of order', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(
      <RunPanel runDetailUrl="/runs/current" tracingListUrl="/runs/current/tracing" />,
    )
    await screen.findByTestId('monaco-editor')
    let resolveEarlierRefresh: (detail: WorkflowRunDetailResponse) => void = () => {}
    mockFetchRunDetail
      .mockReturnValueOnce(
        new Promise<WorkflowRunDetailResponse>((resolve) => {
          resolveEarlierRefresh = resolve
        }),
      )
      .mockResolvedValue(createRunDetail({ outputs: 'Latest result' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await waitFor(() =>
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
        'Latest result',
      ),
    )
    await act(async () => {
      resolveEarlierRefresh(createRunDetail({ outputs: 'Outdated result' }))
    })
    expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
      'Latest result',
    )
  })
  it('keeps the latest tracing refresh and suppresses an older failed detail refresh', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(
      <RunPanel runDetailUrl="/runs/current" tracingListUrl="/runs/current/tracing" />,
    )
    await screen.findByTestId('monaco-editor')
    let rejectEarlierDetail: (error: Error) => void = () => {}
    let resolveEarlierTrace: (value: NodeTracingListResponse) => void = () => {}
    mockFetchRunDetail.mockReturnValueOnce(
      new Promise<WorkflowRunDetailResponse>((_, reject) => {
        rejectEarlierDetail = reject
      }),
    )
    mockFetchTracingList
      .mockReturnValueOnce(
        new Promise<NodeTracingListResponse>((resolve) => {
          resolveEarlierTrace = resolve
        }),
      )
      .mockResolvedValue({ data: [createTracingNode({ title: 'Latest trace' })] })
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await waitFor(() => expect(mockFetchRunDetail).toHaveBeenCalledTimes(3))
    await act(async () => {
      rejectEarlierDetail(new Error('Outdated failure'))
      resolveEarlierTrace({ data: [createTracingNode({ title: 'Outdated trace' })] })
    })
    mockFetchTracingList.mockReturnValue(new Promise(() => {}))
    await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
    expect(screen.getByText('Latest trace')).toBeInTheDocument()
    expect(screen.queryByText('Outdated trace')).not.toBeInTheDocument()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('finishes loading from a newer refresh without waiting for the initial request', async () => {
    const user = userEvent.setup()
    mockFetchRunDetail
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(createRunDetail({ outputs: 'Refreshed result' }))
    renderWorkflowComponent(
      <RunPanel runDetailUrl="/runs/current" tracingListUrl="/runs/current/tracing" />,
    )
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    expect(((await screen.findByTestId('monaco-editor')) as HTMLTextAreaElement).value).toContain(
      'Refreshed result',
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
