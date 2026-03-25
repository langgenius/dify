import type { ChatItemInTree } from '@/app/components/base/chat/types'
import type { HistoryWorkflowData } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import ChatRecord from '../index'
import UserInput from '../user-input'

const mockFetchConversationMessages = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: (...args: unknown[]) => mockFetchConversationMessages(...args),
}))

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getProcessedFilesFromResponse: (files: Array<{ id: string }>) => files.map(file => ({ ...file, processed: true })),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowRun: () => ({
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: ({
    chatList,
    chatNode,
    switchSibling,
  }: {
    chatList: ChatItemInTree[]
    chatNode: React.ReactNode
    switchSibling: (messageId: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => switchSibling('msg-2')}>
        switch sibling
      </button>
      <div data-testid="chat-node">{chatNode}</div>
      {chatList.map(item => (
        <div key={item.id}>{`${item.content}:files-${item.message_files?.length ?? 0}`}</div>
      ))}
    </div>
  ),
}))

const historyWorkflowData: HistoryWorkflowData = {
  id: 'run-1',
  status: 'succeeded',
  conversation_id: 'conversation-1',
  finished_at: 1_700_000_000,
}

describe('ChatRecord integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  it('should render fetched chat history and switch sibling threads', async () => {
    const user = userEvent.setup()

    mockFetchConversationMessages.mockResolvedValue({
      data: [
        {
          id: 'msg-1',
          query: 'Question 1',
          answer: 'Answer 1',
          metadata: {},
          message_files: [
            { id: 'user-file-1', belongs_to: 'user' },
            { id: 'assistant-file-1', belongs_to: 'assistant' },
          ],
        },
        { id: 'msg-2', query: 'Question 2', answer: 'Answer 2', parent_message_id: 'msg-1', metadata: {}, message_files: [] },
        { id: 'msg-3', query: 'Question 3', answer: 'Answer 3', parent_message_id: 'msg-1', metadata: {}, message_files: [] },
      ],
    })

    renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: {
        historyWorkflowData,
      },
    })

    await waitFor(() => {
      expect(mockFetchConversationMessages).toHaveBeenCalledWith('app-1', 'conversation-1')
    })

    expect(await screen.findByText('Question 1:files-1')).toBeInTheDocument()
    expect(screen.getByText('Answer 1:files-1')).toBeInTheDocument()
    expect(screen.getByText('Question 3:files-0')).toBeInTheDocument()
    expect(screen.getByText('Answer 3:files-0')).toBeInTheDocument()
    expect(screen.queryByText('Question 2:files-0')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'switch sibling' }))

    expect(await screen.findByText('Question 2:files-0')).toBeInTheDocument()
    expect(screen.getByText('Answer 2:files-0')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Question 3:files-0')).not.toBeInTheDocument()
    })
  })

  it('should close the record panel and restore the backup draft', async () => {
    const user = userEvent.setup()

    mockFetchConversationMessages.mockResolvedValue({
      data: [
        { id: 'msg-1', query: 'Question 1', answer: 'Answer 1', metadata: {}, message_files: [] },
      ],
    })

    const { container, store } = renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: {
        historyWorkflowData,
      },
    })

    await screen.findByText('Question 1:files-0')

    const closeButton = container.querySelector('.h-6.w-6.cursor-pointer') as HTMLElement
    await user.click(closeButton)

    expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
    expect(store.getState().historyWorkflowData).toBeUndefined()
  })

  it('should stop loading even when conversation fetch fails', async () => {
    mockFetchConversationMessages.mockRejectedValue(new Error('network error'))

    const { container } = renderWorkflowComponent(<ChatRecord />, {
      initialStoreState: {
        historyWorkflowData,
      },
    })

    await waitFor(() => {
      expect(container).toHaveTextContent('TEST CHAT')
    })

    expect(screen.queryByText('Question 1')).not.toBeInTheDocument()
  })

  it('should render no user-input block when the variable list is empty', () => {
    const { container } = render(<UserInput />)

    expect(container.firstChild).toBeNull()
  })

  it('should render provided user-input variables and toggle the panel body', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <UserInput
        variables={[
          { variable: 'query' },
          { variable: 'locale' },
        ]}
        initialExpanded={false}
      />,
    )

    const header = screen.getByText('WORKFLOW.PANEL.USERINPUTFIELD')
    expect(container.querySelectorAll('.mb-2')).toHaveLength(0)

    await user.click(header)
    expect(container.querySelectorAll('.mb-2')).toHaveLength(2)

    await user.click(header)
    expect(container.querySelectorAll('.mb-2')).toHaveLength(0)
  })
})
