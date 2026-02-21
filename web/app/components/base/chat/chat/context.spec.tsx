import type { ChatItem } from '../types'
import type { ChatContextValue } from './context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ChatContextProvider, useChatContext } from './context'

const TestConsumer = () => {
  const context = useChatContext()

  return (
    <div>
      <div data-testid="isResponding">{String(context.isResponding)}</div>
      <div data-testid="readonly">{String(context.readonly)}</div>
      <div data-testid="chatListCount">{context.chatList.length}</div>
      <div data-testid="questionIcon">{context.questionIcon}</div>
      <button onClick={() => context.onSend?.('test message', [])}>Send Button</button>
      <button onClick={() => context.onRegenerate?.({ id: '1' } as ChatItem, { message: 'retry' })}>Regenerate Button</button>
    </div>
  )
}

describe('ChatContextProvider', () => {
  const mockOnSend = vi.fn()
  const mockOnRegenerate = vi.fn()

  const defaultProps: ChatContextValue = {
    config: {} as ChatContextValue['config'],
    isResponding: false,
    chatList: [{ id: '1', content: 'hello' } as ChatItem],
    showPromptLog: false,
    questionIcon: <span data-testid="custom-icon">Icon</span>,
    answerIcon: null,
    onSend: mockOnSend,
    onRegenerate: mockOnRegenerate,
    onAnnotationEdited: vi.fn(),
    onAnnotationAdded: vi.fn(),
    onAnnotationRemoved: vi.fn(),
    disableFeedback: false,
    onFeedback: vi.fn(),
    getHumanInputNodeData: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should provide context values to children', () => {
    render(
      <ChatContextProvider {...defaultProps} readonly={true}>
        <TestConsumer />
      </ChatContextProvider>,
    )

    expect(screen.getByTestId('isResponding')).toHaveTextContent('false')
    expect(screen.getByTestId('readonly')).toHaveTextContent('true')
    expect(screen.getByTestId('chatListCount')).toHaveTextContent('1')
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('should use default values for optional props', () => {
    const minimalProps = { ...defaultProps, chatList: undefined as unknown as ChatItem[] }

    render(
      <ChatContextProvider {...minimalProps}>
        <TestConsumer />
      </ChatContextProvider>,
    )

    expect(screen.getByTestId('chatListCount')).toHaveTextContent('0')
    expect(screen.getByTestId('readonly')).toHaveTextContent('false')
  })

  it('should handle callbacks correctly via the hook', async () => {
    const user = userEvent.setup()
    render(
      <ChatContextProvider {...defaultProps}>
        <TestConsumer />
      </ChatContextProvider>,
    )

    const sendBtn = screen.getByRole('button', { name: /send button/i })
    const regenBtn = screen.getByRole('button', { name: /regenerate button/i })

    await user.click(sendBtn)
    expect(mockOnSend).toHaveBeenCalledWith('test message', [])

    await user.click(regenBtn)
    expect(mockOnRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ message: 'retry' }),
    )
  })
})
