import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AgentOrchestrateAddActionsProvider } from '../add-actions'
import {
  useAgentOrchestrateAddActions,
  useRegisterAgentOrchestrateAddAction,
} from '../add-actions-context'
import { AgentOrchestrateViewingVersionContext } from '../read-only-context'

function RegisteredActionProbe({ onRegister }: { onRegister: () => void }) {
  useRegisterAgentOrchestrateAddAction('skills', onRegister)
  return <ActionsProbe />
}

function ActionsProbe() {
  const actions = useAgentOrchestrateAddActions()

  return <div>{actions.skills ? 'registered' : 'empty'}</div>
}

function ToggleRegisteredActionProbe({ onRegister }: { onRegister: () => void }) {
  const [visible, setVisible] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setVisible(false)}>
        remove action
      </button>
      {visible && <RegisteredActionProbe onRegister={onRegister} />}
      {!visible && <ActionsProbe />}
    </>
  )
}

describe('AgentOrchestrateAddActionsProvider', () => {
  it('registers add actions for editable drafts', () => {
    const action = vi.fn()

    render(
      <AgentOrchestrateAddActionsProvider>
        <RegisteredActionProbe onRegister={action} />
      </AgentOrchestrateAddActionsProvider>,
    )

    expect(screen.getByText('registered')).toBeInTheDocument()
  })

  it('does not expose add actions while viewing a version', () => {
    const action = vi.fn()

    render(
      <AgentOrchestrateViewingVersionContext value>
        <AgentOrchestrateAddActionsProvider>
          <RegisteredActionProbe onRegister={action} />
        </AgentOrchestrateAddActionsProvider>
      </AgentOrchestrateViewingVersionContext>,
    )

    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('unregisters add actions when the owning section unmounts', async () => {
    const user = userEvent.setup()
    const action = vi.fn()

    render(
      <AgentOrchestrateAddActionsProvider>
        <ToggleRegisteredActionProbe onRegister={action} />
      </AgentOrchestrateAddActionsProvider>,
    )

    expect(screen.getByText('registered')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'remove action' }))

    await waitFor(() => {
      expect(screen.getByText('empty')).toBeInTheDocument()
    })
  })
})
