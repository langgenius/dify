import type { IChatItem } from '../type'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchAgentLogDetail } from '@/service/log'
import ChatLogModals from '../chat-log-modals'

vi.mock('@/service/log', () => ({
  fetchAgentLogDetail: vi.fn(),
}))

describe('ChatLogModals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ appDetail: { id: 'app-1' } as ReturnType<typeof useAppStore.getState>['appDetail'] })
  })

  // Modal visibility should follow the two booleans unless log modals are globally hidden.
  describe('Rendering', () => {
    it('should render real prompt and agent log modals when enabled', async () => {
      vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

      render(
        <ChatLogModals
          width={480}
          currentLogItem={{
            id: 'log-1',
            isAnswer: true,
            content: 'reply',
            input: { question: 'hello' },
            log: [{ role: 'user', text: 'Prompt body' }],
            conversationId: 'conversation-1',
          } as IChatItem}
          showPromptLogModal={true}
          showAgentLogModal={true}
          setCurrentLogItem={vi.fn()}
          setShowPromptLogModal={vi.fn()}
          setShowAgentLogModal={vi.fn()}
        />,
      )

      expect(screen.getByText('PROMPT LOG')).toBeInTheDocument()
      expect(screen.getByText('Prompt body')).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /appLog.runDetail.workflowTitle/i })).toBeInTheDocument()
      })
    })

    it('should render nothing when hideLogModal is true', () => {
      render(
        <ChatLogModals
          width={320}
          currentLogItem={{
            id: 'log-2',
            isAnswer: true,
            content: 'reply',
            log: [{ role: 'user', text: 'Prompt body' }],
            conversationId: 'conversation-2',
          } as IChatItem}
          showPromptLogModal={true}
          showAgentLogModal={true}
          hideLogModal={true}
          setCurrentLogItem={vi.fn()}
          setShowPromptLogModal={vi.fn()}
          setShowAgentLogModal={vi.fn()}
        />,
      )

      expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /appLog.runDetail.workflowTitle/i })).not.toBeInTheDocument()
    })
  })

  // Cancel actions should clear the current item and close only the targeted modal.
  describe('User Interactions', () => {
    it('should close the prompt log modal through the real close action', async () => {
      const user = userEvent.setup()
      const setCurrentLogItem = vi.fn()
      const setShowPromptLogModal = vi.fn()
      const setShowAgentLogModal = vi.fn()

      render(
        <ChatLogModals
          width={480}
          currentLogItem={{
            id: 'log-3',
            isAnswer: true,
            content: 'reply',
            input: { question: 'hello' },
            log: [{ role: 'user', text: 'Prompt body' }],
          } as IChatItem}
          showPromptLogModal={true}
          showAgentLogModal={false}
          setCurrentLogItem={setCurrentLogItem}
          setShowPromptLogModal={setShowPromptLogModal}
          setShowAgentLogModal={setShowAgentLogModal}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(setCurrentLogItem).toHaveBeenCalled()
      expect(setShowPromptLogModal).toHaveBeenCalledWith(false)
      expect(setShowAgentLogModal).not.toHaveBeenCalled()
    })

    it('should close the agent log modal through the real close action', async () => {
      const user = userEvent.setup()
      const setCurrentLogItem = vi.fn()
      const setShowPromptLogModal = vi.fn()
      const setShowAgentLogModal = vi.fn()
      vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

      render(
        <ChatLogModals
          width={480}
          currentLogItem={{
            id: 'log-4',
            isAnswer: true,
            content: 'reply',
            input: { question: 'hello' },
            log: [{ role: 'user', text: 'Prompt body' }],
            conversationId: 'conversation-4',
          } as IChatItem}
          showPromptLogModal={false}
          showAgentLogModal={true}
          setCurrentLogItem={setCurrentLogItem}
          setShowPromptLogModal={setShowPromptLogModal}
          setShowAgentLogModal={setShowAgentLogModal}
        />,
      )

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /appLog.runDetail.workflowTitle/i })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('heading', { name: /appLog.runDetail.workflowTitle/i }).nextElementSibling as HTMLElement)

      expect(setCurrentLogItem).toHaveBeenCalled()
      expect(setShowAgentLogModal).toHaveBeenCalledWith(false)
      expect(setShowPromptLogModal).not.toHaveBeenCalled()
    })
  })
})
