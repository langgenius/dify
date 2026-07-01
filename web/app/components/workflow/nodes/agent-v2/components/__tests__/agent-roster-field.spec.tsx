import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { AgentRosterField } from '../agent-roster-field'

vi.mock('@/app/components/workflow/block-selector/agent-selector', () => ({
  AgentSelectorContent: () => null,
}))

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
  it('returns focus to the inline setup trigger when the dialog closes with Escape', async () => {
    const user = userEvent.setup()
    renderInlineRosterField()

    const trigger = screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ })

    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Inline Workspace' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Inline Workspace' })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
  })
})
