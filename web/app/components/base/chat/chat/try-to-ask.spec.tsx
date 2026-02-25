import type { OnSend } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TryToAsk from './try-to-ask'

describe('TryToAsk', () => {
  const mockOnSend: OnSend = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the component with header text', () => {
    render(
      <TryToAsk
        suggestedQuestions={['Question 1']}
        onSend={mockOnSend}
      />,
    )
    expect(screen.getByText(/tryToAsk/i)).toBeInTheDocument()
  })

  it('renders all suggested questions as buttons', () => {
    const questions = ['What is AI?', 'How does it work?', 'Tell me more']

    render(
      <TryToAsk
        suggestedQuestions={questions}
        onSend={mockOnSend}
      />,
    )

    questions.forEach((question) => {
      expect(screen.getByRole('button', { name: question })).toBeInTheDocument()
    })
  })

  it('calls onSend with the correct question when button is clicked', async () => {
    const user = userEvent.setup()
    const questions = ['Question 1', 'Question 2', 'Question 3']

    render(
      <TryToAsk
        suggestedQuestions={questions}
        onSend={mockOnSend}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Question 2' }))

    expect(mockOnSend).toHaveBeenCalledTimes(1)
    expect(mockOnSend).toHaveBeenCalledWith('Question 2')
  })

  it('calls onSend for each button click', async () => {
    const user = userEvent.setup()
    const questions = ['First', 'Second', 'Third']

    render(
      <TryToAsk
        suggestedQuestions={questions}
        onSend={mockOnSend}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'First' }))
    await user.click(screen.getByRole('button', { name: 'Third' }))

    expect(mockOnSend).toHaveBeenCalledTimes(2)
    expect(mockOnSend).toHaveBeenNthCalledWith(1, 'First')
    expect(mockOnSend).toHaveBeenNthCalledWith(2, 'Third')
  })

  it('renders no buttons when suggestedQuestions is empty', () => {
    render(
      <TryToAsk
        suggestedQuestions={[]}
        onSend={mockOnSend}
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders single question correctly', async () => {
    const user = userEvent.setup()
    const question = 'Single question'

    render(
      <TryToAsk
        suggestedQuestions={[question]}
        onSend={mockOnSend}
      />,
    )

    const button = screen.getByRole('button', { name: question })
    expect(button).toBeInTheDocument()

    await user.click(button)
    expect(mockOnSend).toHaveBeenCalledWith(question)
  })
})
