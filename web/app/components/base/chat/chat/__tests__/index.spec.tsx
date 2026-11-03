import type { ChatConfig, ChatItem } from '../../types'
import type { ChatProps } from '../index'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import Chat from '../index'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/chat',
}))

const makeChatItem = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: 'message-1',
  content: 'Test content',
  isAnswer: false,
  ...overrides,
})
const renderChat = (props: Partial<ChatProps> = {}) =>
  render(<Chat chatList={[]} {...props} />, { wrapper: createConsoleQueryWrapper().wrapper })

const suggestionsConfig = { suggested_questions_after_answer: { enabled: true } } as ChatConfig

describe('Chat', () => {
  describe('Agent response announcements', () => {
    const renderAgentContent: NonNullable<ChatProps['renderAgentContent']> = () => null

    it('keeps historical answers silent and announces response lifecycle without streaming tokens', () => {
      const history = [makeChatItem({ id: 'history', isAnswer: true, content: 'Old answer' })]
      const { rerender } = renderChat({ chatList: history, renderAgentContent })
      const status = screen.getByRole('status')
      expect(status).toBeEmptyDOMElement()
      expect(status).toHaveAttribute('aria-atomic', 'true')

      rerender(<Chat chatList={history} renderAgentContent={renderAgentContent} isResponding />)
      expect(screen.getByRole('status')).toBe(status)
      expect(status).toHaveTextContent('agentV2.agentDetail.configure.answer.thinking')

      const streaming = [
        ...history,
        makeChatItem({ id: 'new', isAnswer: true, content: 'First token' }),
      ]
      rerender(<Chat chatList={streaming} renderAgentContent={renderAgentContent} isResponding />)
      expect(status).toHaveTextContent('agentV2.agentDetail.configure.answer.thinking')
      expect(status).not.toHaveTextContent('First token')

      rerender(
        <Chat chatList={streaming} renderAgentContent={renderAgentContent} isResponding={false} />,
      )
      expect(status).toHaveTextContent('agentV2.agentDetail.configure.answer.responseEnded')

      rerender(
        <Chat chatList={history} renderAgentContent={renderAgentContent} isResponding={false} />,
      )
      expect(status).toHaveTextContent('agentV2.agentDetail.configure.answer.responseEnded')

      rerender(<Chat chatList={history} renderAgentContent={renderAgentContent} isResponding />)
      expect(status).toHaveTextContent('agentV2.agentDetail.configure.answer.thinking')
    })

    it('leaves other chat renderers unchanged', () => {
      renderChat({ isResponding: true })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('renders conversation order and enables answer actions after streaming ends', async () => {
    const chatList = [
      makeChatItem({ id: 'q1', content: 'First question' }),
      makeChatItem({ id: 'a1', content: 'First answer', isAnswer: true }),
      makeChatItem({ id: 'q2', content: 'Second question' }),
      makeChatItem({ id: 'a2', content: 'Second answer', isAnswer: true }),
    ]
    const { rerender } = renderChat({ chatList, isResponding: true })
    expect(await screen.findByText('First question')).toBeInTheDocument()
    expect(screen.getByText('Second question')).toBeInTheDocument()
    const firstAnswer = await screen.findByText('First answer')
    const secondAnswer = await screen.findByText('Second answer')
    expect(firstAnswer.compareDocumentPosition(secondAnswer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // Two question copy controls plus only the completed answer's action.
    expect(screen.getAllByRole('button', { name: 'common.operation.copy' })).toHaveLength(3)

    rerender(<Chat chatList={chatList} isResponding={false} />)
    expect(screen.getAllByRole('button', { name: 'common.operation.copy' })).toHaveLength(4)
  })

  it('sends a typed message without requiring upload configuration', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderChat({ onSend, inputPlaceholder: 'Ask the assistant' })
    const input = screen.getByPlaceholderText('Ask the assistant')
    await user.type(input, 'Hello{Enter}')
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Hello', [])
    expect(input).toHaveValue('')
  })

  it.each([true, false])('enforces question editing configuration: %s', async (enabled) => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    const item = makeChatItem({ content: 'Original question' })
    renderChat({
      chatList: [item],
      config: { questionEditEnable: enabled } as ChatConfig,
      onRegenerate,
      noChatInput: true,
    })
    if (!enabled) {
      expect(
        screen.queryByRole('button', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
      return
    }
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Revised question{Enter}')
    expect(onRegenerate).toHaveBeenCalledExactlyOnceWith(item, {
      message: 'Revised question',
      files: undefined,
    })
  })

  it('switches to the selected question sibling', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    renderChat({
      chatList: [makeChatItem({ siblingCount: 2, siblingIndex: 0, nextSibling: 'question-2' })],
      switchSibling,
    })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(switchSibling).toHaveBeenCalledExactlyOnceWith('question-2')
  })

  it('stops a response once and removes the control when responding ends', async () => {
    const user = userEvent.setup()
    const onStopResponding = vi.fn()
    const { rerender } = renderChat({ isResponding: true, onStopResponding, noChatInput: true })
    await user.click(screen.getByRole('button', { name: /stopResponding/i }))
    expect(onStopResponding).toHaveBeenCalledTimes(1)
    rerender(<Chat chatList={[]} isResponding={false} noChatInput />)
    expect(screen.queryByRole('button', { name: /stopResponding/i })).not.toBeInTheDocument()
  })

  it('hides the stop action when the owner disables it', () => {
    renderChat({ isResponding: true, noStopResponding: true })
    expect(screen.queryByRole('button', { name: /stopResponding/i })).not.toBeInTheDocument()
  })

  it('sends the selected suggested question', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderChat({
      config: suggestionsConfig,
      suggestedQuestions: ['First question', 'Second question'],
      onSend,
    })
    await user.click(screen.getByRole('button', { name: 'Second question' }))
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Second question')
  })

  it.each([
    { config: undefined },
    { config: { suggested_questions_after_answer: { enabled: false } } as ChatConfig },
    { suggestedQuestions: [] },
    { onSend: undefined },
  ])('hides unavailable suggestions: %j', (overrides) => {
    renderChat({
      config: suggestionsConfig,
      suggestedQuestions: ['Ask this'],
      onSend: vi.fn(),
      ...overrides,
    })
    expect(screen.queryByRole('button', { name: 'Ask this' })).not.toBeInTheDocument()
  })

  it.each([{ readonly: true }, { inputDisabled: true }])(
    'prevents input when %j',
    async (props) => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      renderChat({ ...props, onSend })
      await user.type(screen.getByRole('textbox'), 'Blocked{Enter}')
      expect(onSend).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue('')
    },
  )

  it('removes the input while keeping custom conversation content', () => {
    renderChat({ noChatInput: true, chatNode: <p>Conversation archived</p> })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Conversation archived')).toBeInTheDocument()
  })
})
