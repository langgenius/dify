import type { Mock } from 'vitest' // Or 'jest' if using Jest
import type { IChatItem } from '../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useChatContext } from '../context'
import SuggestedQuestions from './suggested-questions'

// Mock the chat context
vi.mock('../context', () => ({
  useChatContext: vi.fn(),
}))

describe('SuggestedQuestions', () => {
  const mockOnSend = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks();
    // Use 'as Mock' instead of 'as any'
    (useChatContext as Mock).mockReturnValue({
      onSend: mockOnSend,
      readonly: false,
    })
  })

  const mockItem: IChatItem = {
    id: '1',
    content: '',
    isAnswer: true,
    isOpeningStatement: true,
    suggestedQuestions: ['What is Dify?', 'How to use it?', '  ', ''],
  }

  it('should render suggested questions and filter out empty ones', () => {
    render(<SuggestedQuestions item={mockItem} />)

    const questions = screen.getAllByTestId('suggested-question')
    expect(questions).toHaveLength(2)
    expect(questions[0]).toHaveTextContent('What is Dify?')
    expect(questions[1]).toHaveTextContent('How to use it?')
  })

  it('should call onSend when a question is clicked', async () => {
    const user = userEvent.setup()
    render(<SuggestedQuestions item={mockItem} />)

    const questions = screen.getAllByTestId('suggested-question')
    await user.click(questions[0])

    expect(mockOnSend).toHaveBeenCalledWith('What is Dify?')
  })

  it('should not render if isOpeningStatement is false', () => {
    render(<SuggestedQuestions item={{ ...mockItem, isOpeningStatement: false }} />)
    expect(screen.queryByTestId('suggested-question')).not.toBeInTheDocument()
  })

  it('should not render if suggestedQuestions is missing or empty', () => {
    render(<SuggestedQuestions item={{ ...mockItem, suggestedQuestions: [] }} />)
    expect(screen.queryByTestId('suggested-question')).not.toBeInTheDocument()

    // Use 'as IChatItem' instead of 'as any'
    render(<SuggestedQuestions item={{ ...mockItem, suggestedQuestions: undefined } as IChatItem} />)
    expect(screen.queryByTestId('suggested-question')).not.toBeInTheDocument()
  })

  it('should be disabled and not call onSend when readonly is true', async () => {
    const user = userEvent.setup();
    // Use 'as Mock' instead of 'as any'
    (useChatContext as Mock).mockReturnValue({
      onSend: mockOnSend,
      readonly: true,
    })

    render(<SuggestedQuestions item={mockItem} />)

    const questions = screen.getAllByTestId('suggested-question')
    expect(questions[0]).toHaveClass('pointer-events-none')
    expect(questions[0]).toHaveClass('opacity-50')

    await user.click(questions[0])
    expect(mockOnSend).not.toHaveBeenCalled()
  })
})
