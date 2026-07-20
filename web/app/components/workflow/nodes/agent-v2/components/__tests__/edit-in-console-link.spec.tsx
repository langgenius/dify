import { render, screen } from '@testing-library/react'
import { EditInConsoleLink } from '../edit-in-console-link'

describe('EditInConsoleLink', () => {
  it('renders a link to the agent console when permitted', () => {
    render(<EditInConsoleLink agentId="agent-1" canManageAgents />)

    const link = screen.getByRole('link', { name: /editInConsole/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('/agents/agent-1'))
  })

  it('renders a disabled control instead of a link when not permitted', () => {
    render(<EditInConsoleLink agentId="agent-1" canManageAgents={false} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editInConsole/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
