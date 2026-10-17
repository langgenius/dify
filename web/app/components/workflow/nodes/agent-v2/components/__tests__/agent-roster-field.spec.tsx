import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AgentRosterField } from '../agent-roster-field'

vi.mock('@/features/agent-v2/permissions', () => ({
  useCanCreateAgents: () => true,
}))

function renderDetailRosterField(permissionKeys = ['agent.acl.edit']) {
  const onMakeCopy = vi.fn()
  function Harness() {
    const portalContainerRef = useRef<HTMLDivElement>(null)

    return (
      <div ref={portalContainerRef}>
        <AgentRosterField
          agent={{
            id: 'roster-agent-1',
            name: 'Roster Agent',
            permission_keys: permissionKeys,
            role: 'Shared roster agent',
          }}
          portalContainerRef={portalContainerRef}
          onChange={vi.fn()}
          onMakeCopy={onMakeCopy}
        />
      </div>
    )
  }

  render(<Harness />)
  return { onMakeCopy }
}

describe('AgentRosterField', () => {
  it('copies the roster agent from its detail panel', async () => {
    const user = userEvent.setup()
    const { onMakeCopy } = renderDetailRosterField()

    await user.click(
      screen.getByRole('button', { name: /^workflowAgent\.nodes\.agent\.roster\.openPanel/ }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'workflowAgent.nodes.agent.roster.makeCopy' }),
    )
    expect(onMakeCopy).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('link', { name: 'workflowAgent.nodes.agent.roster.editInConsole' }),
    ).toHaveAttribute('href', expect.stringContaining('roster-agent-1'))
  })

  it('does not offer editing for a preview-only Agent', async () => {
    const user = userEvent.setup()
    renderDetailRosterField(['agent.acl.preview'])

    await user.click(
      screen.getByRole('button', { name: /^workflowAgent\.nodes\.agent\.roster\.openPanel/ }),
    )

    expect(
      screen.queryByRole('link', { name: 'workflowAgent.nodes.agent.roster.editInConsole' }),
    ).not.toBeInTheDocument()
  })
})
