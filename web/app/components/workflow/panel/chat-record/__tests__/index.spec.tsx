import type { HistoryWorkflowData } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fetchConversationMessages } from '@/service/debug'
import ChatRecord from '../index'

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: vi.fn(),
}))

const mockFetchConversationMessages = vi.mocked(fetchConversationMessages)

const historyWorkflowData: HistoryWorkflowData = {
  id: 'run-1',
  status: 'succeeded',
  conversation_id: 'conversation-1',
  finished_at: 1_700_000_000,
}

describe('ChatRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  it('renders fetched chat history with the real chat shell and switches siblings', async () => {
    const user = userEvent.setup()

    mockFetchConversationMessages.mockResolvedValue({
      data: [
        {
          id: 'msg-1',
          query: 'Question 1',
          answer: 'Answer 1',
          metadata: {},
          message_files: [],
        },
        { id: 'msg-2', query: 'Question 2', answer: 'Answer 2', parent_message_id: 'msg-1', metadata: {}, message_files: [] },
        { id: 'msg-3', query: 'Question 3', answer: 'Answer 3', parent_message_id: 'msg-1', metadata: {}, message_files: [] },
      ],
    } as never)

    renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: { historyWorkflowData },
      hooksStoreProps: {
        handleLoadBackupDraft: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(mockFetchConversationMessages).toHaveBeenCalledWith('app-1', 'conversation-1')
    })

    expect(await screen.findByText('Question 1')).toBeInTheDocument()
    expect(screen.getByText('Answer 1')).toBeInTheDocument()
    expect(screen.getByText('Question 3')).toBeInTheDocument()
    expect(screen.getByText('Answer 3')).toBeInTheDocument()
    expect(screen.queryByText('Question 2')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous' }))

    expect(await screen.findByText('Question 2')).toBeInTheDocument()
    expect(screen.getByText('Answer 2')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Question 3')).not.toBeInTheDocument()
    })
  })

  it('closes the record panel and restores the backup draft', async () => {
    const user = userEvent.setup()
    const handleLoadBackupDraft = vi.fn()

    mockFetchConversationMessages.mockResolvedValue({
      data: [
        { id: 'msg-1', query: 'Question 1', answer: 'Answer 1', metadata: {}, message_files: [] },
      ],
    } as never)

    const { container, store } = renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: { historyWorkflowData },
      hooksStoreProps: { handleLoadBackupDraft },
    })

    await screen.findByText('Question 1')

    await user.click(container.querySelector('.h-6.w-6.cursor-pointer') as HTMLElement)

    expect(handleLoadBackupDraft).toHaveBeenCalledTimes(1)
    expect(store.getState().historyWorkflowData).toBeUndefined()
  })

  it('stops loading when conversation fetching fails', async () => {
    mockFetchConversationMessages.mockRejectedValue(new Error('network error'))

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
