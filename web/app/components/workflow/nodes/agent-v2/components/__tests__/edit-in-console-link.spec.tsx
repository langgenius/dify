import { render, screen } from '@testing-library/react'
import { EditInConsoleLink } from '../edit-in-console-link'

describe('EditInConsoleLink', () => {
  it('renders a link to the agent console without a workspace preview gate', () => {
    render(<EditInConsoleLink agentId="agent-1" />)

    const link = screen.getByRole('link', { name: /editInConsole/ })
    expect(link).toHaveAttribute('href', '/agents/agent-1/configure')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
