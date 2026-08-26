import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditInConsoleLink } from '../edit-in-console-link'

const systemFeatures = vi.hoisted(() => ({ rbacEnabled: false }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useSuspenseQuery: () => ({ data: { rbac_enabled: systemFeatures.rbacEnabled } }),
  }
})

describe('EditInConsoleLink', () => {
  beforeEach(() => {
    systemFeatures.rbacEnabled = false
  })

  it('renders a link to the agent console when permitted', () => {
    render(<EditInConsoleLink agentId="agent-1" canManageAgents />)

    const link = screen.getByRole('link', { name: /editInConsole/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('/agents/agent-1'))
  })

  it('explains the role requirement when editing is not permitted', async () => {
    const user = userEvent.setup()
    render(<EditInConsoleLink agentId="agent-1" canManageAgents={false} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: /editInConsole/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'workflow.nodes.agent.roster.editInConsoleDisabled',
    )
  })

  it('includes the Manage Agents permission in the RBAC explanation', async () => {
    const user = userEvent.setup()
    systemFeatures.rbacEnabled = true
    render(<EditInConsoleLink agentId="agent-1" canManageAgents={false} />)

    await user.hover(screen.getByRole('button', { name: /editInConsole/ }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'workflow.nodes.agent.roster.editInConsoleDisabledRbac',
    )
  })
})
