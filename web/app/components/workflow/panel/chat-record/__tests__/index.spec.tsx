import type { HistoryWorkflowData } from '@/app/components/workflow/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import ChatRecord from '../index'

const routeParams = vi.hoisted(() => ({ appId: 'app-1' }))
const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => routeParams,
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
}))

const historyWorkflowData: HistoryWorkflowData = {
  id: 'run-1',
  status: 'succeeded',
  conversation_id: 'conversation-1',
  finished_at: 1_700_000_000,
}

describe('ChatRecord', () => {
  beforeEach(() => {
    routeParams.appId = 'app-1'
    mockRequest.mockReset()
  })

  it('renders chat history and keeps sibling selection within its conversation', async () => {
    const user = userEvent.setup()

    mockRequest.mockResolvedValue({
      data: [
        {
          id: 'msg-1',
          query: 'Question 1',
          answer: 'Answer 1',
          metadata: {},
          message_files: [],
        },
        {
          id: 'msg-2',
          query: 'Question 2',
          answer: 'Answer 2',
          parent_message_id: 'msg-1',
          metadata: {},
          message_files: [],
        },
        {
          id: 'msg-3',
          query: 'Question 3',
          answer: 'Answer 3',
          parent_message_id: 'msg-1',
          metadata: {},
          message_files: [],
        },
      ],
    } as never)

    const { store } = renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: { historyWorkflowData },
      hooksStoreProps: {
        handleLoadBackupDraft: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'chatMessages', 'get'],
        { params: { app_id: 'app-1' }, query: { conversation_id: 'conversation-1' } },
        expect.any(Object),
      )
    })

    expect(await screen.findByText('Question 1')).toBeInTheDocument()
    expect(screen.getByText('Answer 1')).toBeInTheDocument()
    expect(screen.getByText('Question 3')).toBeInTheDocument()
    expect(screen.getByText('Answer 3')).toBeInTheDocument()
    expect(screen.queryByText('Question 2')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'common.operation.log' })).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Previous' }))

    expect(await screen.findByText('Question 2')).toBeInTheDocument()
    expect(screen.getByText('Answer 2')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Question 3')).not.toBeInTheDocument()
    })

    act(() => {
      store.setState({
        historyWorkflowData: { ...historyWorkflowData, conversation_id: 'conversation-2' },
      })
    })
    expect(await screen.findByText('Question 3')).toBeInTheDocument()
    expect(screen.queryByText('Question 2')).not.toBeInTheDocument()
    expect(mockRequest).toHaveBeenLastCalledWith(
      ['apps', 'byAppId', 'chatMessages', 'get'],
      { params: { app_id: 'app-1' }, query: { conversation_id: 'conversation-2' } },
      expect.any(Object),
    )
  })

  it('keeps a late response from a previous app out of the current conversation', async () => {
    let resolvePrevious!: (value: unknown) => void
    mockRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePrevious = resolve
      }),
    )
    mockRequest.mockResolvedValue({
      data: [{ id: 'message-2', query: 'Current question', answer: 'Current answer' }],
      has_more: false,
      limit: 20,
    })
    const { store } = renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: { historyWorkflowData },
    })
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))

    routeParams.appId = 'app-2'
    act(() => {
      store.setState({
        historyWorkflowData: { ...historyWorkflowData, conversation_id: 'conversation-2' },
      })
    })
    expect(await screen.findByText('Current answer')).toBeInTheDocument()
    expect(mockRequest).toHaveBeenLastCalledWith(
      ['apps', 'byAppId', 'chatMessages', 'get'],
      { params: { app_id: 'app-2' }, query: { conversation_id: 'conversation-2' } },
      expect.any(Object),
    )

    await act(async () => {
      resolvePrevious({
        data: [{ id: 'message-1', query: 'Previous question', answer: 'Previous answer' }],
        has_more: false,
        limit: 20,
      })
    })
    expect(screen.queryByText('Previous answer')).not.toBeInTheDocument()
    expect(screen.getByText('Current answer')).toBeInTheDocument()
  })

  it('stops loading when conversation fetching fails', async () => {
    mockRequest.mockRejectedValue(new Error('network error'))

    const { container } = renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: { historyWorkflowData },
      hooksStoreProps: {
        handleLoadBackupDraft: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(container).toHaveTextContent('TEST CHAT')
    })

    expect(screen.queryByText('Question 1')).not.toBeInTheDocument()
  })
})
