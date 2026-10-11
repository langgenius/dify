import type { Mock } from 'vite-plus/test'
import type { IChatItem } from '../../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useChatContext } from '../../context'
import SuggestedQuestions from '../suggested-questions'

vi.mock('../../context', () => ({
  useChatContext: vi.fn(),
}))

describe('SuggestedQuestions', () => {
  const mockOnSend = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useChatContext as Mock).mockReturnValue({
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

    const questions = screen.getAllByRole('button')
    expect(questions).toHaveLength(2)
    expect(questions[0]).toHaveAccessibleName('What is Dify?')
    expect(questions[1]).toHaveAccessibleName('How to use it?')
  })

  it('should call onSend when a question is clicked', async () => {
    const user = userEvent.setup()
    render(<SuggestedQuestions item={mockItem} />)

    await user.click(screen.getByRole('button', { name: 'What is Dify?' }))

    expect(mockOnSend).toHaveBeenCalledWith('What is Dify?')
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('should send a question with the %s key', async (_, key) => {
    const user = userEvent.setup()
    render(<SuggestedQuestions item={mockItem} />)

    const question = screen.getByRole('button', { name: 'What is Dify?' })
    question.focus()
    await user.keyboard(key)

    expect(mockOnSend).toHaveBeenCalledWith('What is Dify?')
  })

  it('should not render if isOpeningStatement is false', () => {
    render(<SuggestedQuestions item={{ ...mockItem, isOpeningStatement: false }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should not render if suggestedQuestions is missing or empty', () => {
    render(<SuggestedQuestions item={{ ...mockItem, suggestedQuestions: [] }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    render(
      <SuggestedQuestions item={{ ...mockItem, suggestedQuestions: undefined } as IChatItem} />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should be disabled and not call onSend when readonly is true', async () => {
    const user = userEvent.setup()
    ;(useChatContext as Mock).mockReturnValue({
      onSend: mockOnSend,
      readonly: true,
    })

    render(<SuggestedQuestions item={mockItem} />)

    const question = screen.getByRole('button', { name: 'What is Dify?' })
    expect(question).toBeDisabled()

    await user.click(question)
    expect(mockOnSend).not.toHaveBeenCalled()
  })
})
