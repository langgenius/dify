import type { ChatConfig, ChatItem } from '../../types'
import type { ChatProps } from '../index'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Chat from '../index'

// Keep answer rendering at the component boundary; exercise real questions,
// suggestions and input controls through Chat's shared context.
vi.mock('../answer', () => ({
  default: ({
    item,
    responding,
    question,
  }: {
    item: ChatItem
    responding?: boolean
    question: string
  }) => (
    <article aria-label={`Answer to ${question}`} aria-busy={!!responding}>
      {item.content}
    </article>
  ),
}))

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
const renderChat = (props: Partial<ChatProps> = {}) => render(<Chat chatList={[]} {...props} />)

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

  it('renders conversation order and marks only the latest answer as responding', async () => {
    const chatList = [
      makeChatItem({ id: 'q1', content: 'First question' }),
      makeChatItem({ id: 'a1', content: 'First answer', isAnswer: true }),
      makeChatItem({ id: 'q2', content: 'Second question' }),
      makeChatItem({ id: 'a2', content: 'Second answer', isAnswer: true }),
    ]
    const { rerender } = renderChat({ chatList, isResponding: true })
    expect(await screen.findByText('First question')).toBeInTheDocument()
    expect(screen.getByText('Second question')).toBeInTheDocument()
    const answers = screen.getAllByRole('article')
    expect(answers.map((answer) => answer.textContent)).toEqual(['First answer', 'Second answer'])
    expect(answers[0]).toHaveAccessibleName('Answer to First question')
    expect(answers[1]).toHaveAccessibleName('Answer to Second question')
    expect(answers[0]).toHaveAttribute('aria-busy', 'false')
    expect(answers[1]).toHaveAttribute('aria-busy', 'true')

    rerender(<Chat chatList={chatList} isResponding={false} />)
    expect(
      screen
        .getAllByRole('article')
        .every((answer) => answer.getAttribute('aria-busy') === 'false'),
    ).toBe(true)
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
