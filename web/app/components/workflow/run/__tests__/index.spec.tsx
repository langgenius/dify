import type { WorkflowRunDetailResponse } from '@/models/log'
import type { WorkflowRunOwner } from '@/service/log'
import type { NodeTracing } from '@/types/workflow'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createHttpError } from '@/service/http-error'
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

const TEST_OWNER: WorkflowRunOwner = { kind: 'app', appId: 'app-1' }

const createRunDetail = (
  overrides: Partial<WorkflowRunDetailResponse> = {},
): WorkflowRunDetailResponse => ({
  id: 'run-1',
  version: '1',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: { topic: 'workflow' },
  status: 'succeeded',
  outputs: { result: 'workflow output', steps: 2 },
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
    mockFetchTracingList.mockResolvedValue([createTracingNode()])
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
      <RunPanel owner={TEST_OWNER} runId="run-1" getResultCallback={handleResult} />,
    )

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith(TEST_OWNER, 'run-1')
      expect(mockFetchTracingList).toHaveBeenCalledWith(TEST_OWNER, 'run-1')
      expect(handleResult).toHaveBeenCalledWith(runDetail)
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
        'workflow output',
      )
    })
  })

  it('switches between detail, tracing, and result tabs with real child panels', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<RunPanel activeTab="RESULT" owner={TEST_OWNER} runId="run-2" />, {
      initialStoreState: {
        isListening: true,
      },
    })

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
      <RunPanel hideResult activeTab="DETAIL" owner={TEST_OWNER} runId="run-1" />,
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

  it('reports run-detail and tracing failures through toast.error', async () => {
    mockFetchRunDetail.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 500 }), { message: 'detail boom' }),
    )
    mockFetchTracingList.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 500 }), { message: 'tracing boom' }),
    )

    renderWorkflowComponent(<RunPanel owner={TEST_OWNER} runId="run-3" />)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('detail boom')
      expect(mockToastError).toHaveBeenCalledWith('tracing boom')
    })
  })

  it.each(['RESULT', 'DETAIL', 'TRACING'] as const)(
    'refreshes data when the already selected %s tab is clicked',
    async (activeTab) => {
      const user = userEvent.setup()
      renderWorkflowComponent(<RunPanel activeTab={activeTab} owner={TEST_OWNER} runId="run-1" />)

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
      .mockResolvedValue(
        createRunDetail({ id: 'new-run', outputs: { result: 'New result', steps: 2 } }),
      )
    const { rerender } = renderWorkflowComponent(
      <RunPanel owner={TEST_OWNER} runId="old-run" getResultCallback={handleResult} />,
    )
    await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
    rerender(<RunPanel owner={TEST_OWNER} runId="new-run" getResultCallback={handleResult} />)
    expect(screen.getByRole('tab', { name: 'runLog.tracing' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await screen.findByText('Trace Node')
    await act(async () => {
      resolveOldResponse(
        createRunDetail({ id: 'old-run', outputs: { result: 'Old result', steps: 2 } }),
      )
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
    const { rerender } = renderWorkflowComponent(<RunPanel owner={TEST_OWNER} runId="first" />)
    await screen.findByTestId('monaco-editor')
    let rejectRefresh: (error: Error) => void = () => {}
    mockFetchRunDetail
      .mockReturnValueOnce(
        new Promise<WorkflowRunDetailResponse>((_, reject) => {
          rejectRefresh = reject
        }),
      )
      .mockResolvedValue(
        createRunDetail({ id: 'next', outputs: { result: 'Next result', steps: 2 } }),
      )
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    rerender(<RunPanel owner={TEST_OWNER} runId="next" />)
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
    let resolveOldTrace: (value: NodeTracing[]) => void = () => {}
    mockFetchTracingList
      .mockReturnValueOnce(
        new Promise<NodeTracing[]>((resolve) => {
          resolveOldTrace = resolve
        }),
      )
      .mockResolvedValue([createTracingNode({ title: 'New trace' })])
    const { rerender } = renderWorkflowComponent(
      <RunPanel activeTab="TRACING" owner={TEST_OWNER} runId="old" />,
    )
    await waitFor(() => expect(mockFetchTracingList).toHaveBeenCalledTimes(1))
    rerender(<RunPanel activeTab="TRACING" owner={TEST_OWNER} runId="new" />)
    await screen.findByText('New trace')
    await act(async () => {
      resolveOldTrace([createTracingNode({ title: 'Old trace' })])
    })
    expect(screen.getByText('New trace')).toBeInTheDocument()
    expect(screen.queryByText('Old trace')).not.toBeInTheDocument()
  })
  it('does not restart the record request when its result callback changes', async () => {
    const user = userEvent.setup()
    const firstCallback = vi.fn()
    const nextCallback = vi.fn()
    const { rerender } = renderWorkflowComponent(
      <RunPanel owner={TEST_OWNER} runId="record" getResultCallback={firstCallback} />,
    )
    await screen.findByTestId('monaco-editor')
    rerender(<RunPanel owner={TEST_OWNER} runId="record" getResultCallback={nextCallback} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(mockFetchRunDetail).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await waitFor(() => expect(nextCallback).toHaveBeenCalledTimes(1))
    expect(firstCallback).toHaveBeenCalledTimes(1)
  })
  it('keeps the latest refresh when requests for the same record resolve out of order', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<RunPanel owner={TEST_OWNER} runId="current" />)
    await screen.findByTestId('monaco-editor')
    let resolveEarlierRefresh: (detail: WorkflowRunDetailResponse) => void = () => {}
    mockFetchRunDetail
      .mockReturnValueOnce(
        new Promise<WorkflowRunDetailResponse>((resolve) => {
          resolveEarlierRefresh = resolve
        }),
      )
      .mockResolvedValue(createRunDetail({ outputs: { result: 'Latest result', steps: 2 } }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await waitFor(() =>
      expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
        'Latest result',
      ),
    )
    await act(async () => {
      resolveEarlierRefresh(createRunDetail({ outputs: { result: 'Outdated result', steps: 2 } }))
    })
    expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain(
      'Latest result',
    )
  })
  it('keeps the latest tracing refresh and suppresses an older failed detail refresh', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<RunPanel owner={TEST_OWNER} runId="current" />)
    await screen.findByTestId('monaco-editor')
    let rejectEarlierDetail: (error: Error) => void = () => {}
    let resolveEarlierTrace: (value: NodeTracing[]) => void = () => {}
    mockFetchRunDetail.mockReturnValueOnce(
      new Promise<WorkflowRunDetailResponse>((_, reject) => {
        rejectEarlierDetail = reject
      }),
    )
    mockFetchTracingList
      .mockReturnValueOnce(
        new Promise<NodeTracing[]>((resolve) => {
          resolveEarlierTrace = resolve
        }),
      )
      .mockResolvedValue([createTracingNode({ title: 'Latest trace' })])
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    await waitFor(() => expect(mockFetchRunDetail).toHaveBeenCalledTimes(3))
    await act(async () => {
      rejectEarlierDetail(new Error('Outdated failure'))
      resolveEarlierTrace([createTracingNode({ title: 'Outdated trace' })])
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
      .mockResolvedValue(createRunDetail({ outputs: { result: 'Refreshed result', steps: 2 } }))
    renderWorkflowComponent(<RunPanel owner={TEST_OWNER} runId="current" />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'runLog.result' }))
    expect(((await screen.findByTestId('monaco-editor')) as HTMLTextAreaElement).value).toContain(
      'Refreshed result',
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
