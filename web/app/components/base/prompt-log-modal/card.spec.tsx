import { render, screen } from '@testing-library/react'
import Card from './card'

describe('PromptLogModal Card', () => {
  it('renders single log entry correctly', () => {
    const log = [{ role: 'user', text: 'Single entry text' }]
    render(<Card log={log} />)

    expect(screen.getByText('Single entry text')).toBeInTheDocument()
    expect(screen.queryByText('USER')).not.toBeInTheDocument()
  })

  it('renders multiple log entries correctly', () => {
    const log = [
      { role: 'user', text: 'Message 1' },
      { role: 'assistant', text: 'Message 2' },
    ]
    render(<Card log={log} />)

    expect(screen.getByText('USER')).toBeInTheDocument()
    expect(screen.getByText('ASSISTANT')).toBeInTheDocument()
    expect(screen.getByText('Message 1')).toBeInTheDocument()
    expect(screen.getByText('Message 2')).toBeInTheDocument()
  })
})
