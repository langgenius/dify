import { screen, waitForElementToBeRemoved, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AgentRosterField } from '../agent-roster-field'

function renderDetailRosterField(
  permissionKeys = ['agent.acl.edit'],
  role = 'Shared roster agent',
) {
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
            role,
            description: 'Agent description',
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
  it('keeps the inline dialog close control available before its workspace loads', async () => {
    const user = userEvent.setup()
    function Harness() {
      const portalContainerRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={portalContainerRef}>
          <AgentRosterField
            agent={{ id: 'inline-agent', name: 'Inline Agent' }}
            isInlineSetup
            portalContainerRef={portalContainerRef}
            onChange={vi.fn()}
          />
        </div>
      )
    }
    render(<Harness />)
    await user.click(
      screen.getByRole('button', { name: /^workflowAgent\.nodes\.agent\.roster\.openPanel/ }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Inline Agent' })
    const closed = waitForElementToBeRemoved(dialog)
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await closed
  })

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

  it('does not substitute the agent description for an empty role', async () => {
    const user = userEvent.setup()
    renderDetailRosterField(['agent.acl.edit'], '')
    expect(screen.queryByText('Agent description')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /^workflowAgent\.nodes\.agent\.roster\.openPanel/ }),
    )
    expect(screen.queryByText('Agent description')).not.toBeInTheDocument()
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
