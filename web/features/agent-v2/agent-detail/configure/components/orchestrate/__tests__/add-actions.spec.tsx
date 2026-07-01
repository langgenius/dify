import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentOrchestrateAddActionsProvider } from '../add-actions'
import { useAgentOrchestrateAddActions, useRegisterAgentOrchestrateAddAction } from '../add-actions-context'

function InlineActionRegisterer({
  label,
  onAction,
}: {
  label: string
  onAction: (label: string) => void
}) {
  useRegisterAgentOrchestrateAddAction('knowledge', () => {
    onAction(label)
  })

  return null
}

function RegisteredActionTrigger() {
  const actions = useAgentOrchestrateAddActions()

  return (
    <button type="button" disabled={!actions.knowledge} onClick={() => actions.knowledge?.()}>
      Run action
    </button>
  )
}

describe('AgentOrchestrateAddActionsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Registration', () => {
    it('should keep the registered action stable while calling the latest callback when the action prop changes every render', async () => {
      const handleAction = vi.fn()

      const { rerender } = render(
        <AgentOrchestrateAddActionsProvider>
          <InlineActionRegisterer label="first" onAction={handleAction} />
          <RegisteredActionTrigger />
        </AgentOrchestrateAddActionsProvider>,
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Run action' })).toBeEnabled()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Run action' }))

      rerender(
        <AgentOrchestrateAddActionsProvider>
          <InlineActionRegisterer label="second" onAction={handleAction} />
          <RegisteredActionTrigger />
        </AgentOrchestrateAddActionsProvider>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Run action' }))

      expect(handleAction).toHaveBeenNthCalledWith(1, 'first')
      expect(handleAction).toHaveBeenNthCalledWith(2, 'second')
    })
  })
})
