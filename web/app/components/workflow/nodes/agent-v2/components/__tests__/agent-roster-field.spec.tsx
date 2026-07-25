import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { AgentRosterField } from '../agent-roster-field'

const permission = vi.hoisted(() => ({ canManageAgents: true }))

vi.mock('@/features/agent-v2/permissions', () => ({
  useCanManageAgents: () => permission.canManageAgents,
}))

vi.mock('@/app/components/workflow/block-selector/agent-selector', () => ({
  AgentSelectorContent: () => null,
}))

function renderDetailRosterField() {
  function Harness() {
    const portalContainerRef = useRef<HTMLDivElement>(null)

    return (
      <div ref={portalContainerRef}>
        <AgentRosterField
          agent={{
            id: 'roster-agent-1',
            name: 'Roster Agent',
            role: 'Shared roster agent',
          }}
          portalContainerRef={portalContainerRef}
          onChange={vi.fn()}
          onMakeCopy={vi.fn()}
        />
      </div>
    )
  }

  render(<Harness />)
}

function renderInlineRosterField() {
  function Harness() {
    const portalContainerRef = useRef<HTMLDivElement>(null)

    return (
      <div ref={portalContainerRef}>
        <AgentRosterField
          agent={{
            id: 'inline-agent-1',
            name: 'Inline Workspace',
            role: 'Workflow-only agent',
          }}
          isInlineSetup
          panelBody={<button type="button">Inline workspace action</button>}
          portalContainerRef={portalContainerRef}
          onChange={vi.fn()}
        />
      </div>
    )
  }

  render(<Harness />)
}

describe('AgentRosterField', () => {
  beforeEach(() => {
    permission.canManageAgents = true
  })

  it('shows Make Copy in the roster detail panel', async () => {
    const user = userEvent.setup()
    renderDetailRosterField()

    await user.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )

    expect(
      await screen.findByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' }),
    ).toBeInTheDocument()
  })

  it('keeps Make Copy available when the user cannot manage agents', async () => {
    permission.canManageAgents = false
    const user = userEvent.setup()
    renderDetailRosterField()

    await user.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )

    expect(
      await screen.findByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' }),
    ).toBeInTheDocument()
  })

  it('returns focus to the inline setup trigger when the dialog closes with Escape', async () => {
    const user = userEvent.setup()
    renderInlineRosterField()

    const trigger = screen.getByRole('button', {
      name: /^workflow\.nodes\.agent\.roster\.openPanel/,
    })

    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Inline Workspace' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Inline Workspace' })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
  })
})
