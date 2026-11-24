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

  return (
    <button
      type="button"
      disabled={!actions.skills}
      onClick={() => actions.skills?.({ skillSource: 'upload' })}
    >
      add skill
    </button>
  )
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
  it('does not expose add actions while viewing a version', async () => {
    const user = userEvent.setup()
    const action = vi.fn()

    render(
      <AgentOrchestrateViewingVersionContext value>
        <AgentOrchestrateAddActionsProvider>
          <RegisteredActionProbe onRegister={action} />
        </AgentOrchestrateAddActionsProvider>
      </AgentOrchestrateViewingVersionContext>,
    )

    expect(screen.getByRole('button', { name: 'add skill' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'add skill' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('unregisters add actions when the owning section unmounts', async () => {
    const user = userEvent.setup()
    const action = vi.fn()

    render(
      <AgentOrchestrateAddActionsProvider>
        <ToggleRegisteredActionProbe onRegister={action} />
      </AgentOrchestrateAddActionsProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'add skill' }))
    expect(action).toHaveBeenCalledExactlyOnceWith({ skillSource: 'upload' })

    await user.click(screen.getByRole('button', { name: 'remove action' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'add skill' })).toBeDisabled()
    })
    await user.click(screen.getByRole('button', { name: 'add skill' }))
    expect(action).toHaveBeenCalledOnce()
  })
})
