import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TryToAsk from '../try-to-ask'

describe('TryToAsk', () => {
  it('sends the selected suggested question', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<TryToAsk suggestedQuestions={['What is AI?', 'Tell me more']} onSend={onSend} />)

    await user.click(screen.getByRole('button', { name: 'Tell me more' }))

    expect(onSend).toHaveBeenCalledWith('Tell me more')
  })

  it('offers no actions when there are no suggestions', () => {
    render(<TryToAsk suggestedQuestions={[]} onSend={vi.fn()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
