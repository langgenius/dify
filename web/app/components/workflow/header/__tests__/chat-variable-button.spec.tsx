import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import ChatVariableButton from '../chat-variable-button'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

describe('ChatVariableButton', () => {
  it('opens the chat variable panel and closes the other workflow panels', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<ChatVariableButton disabled={false} />, {
      initialStoreState: {
        showEnvPanel: true,
        showGlobalVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.chatVariable.panelTitle' }))

    expect(store.getState().showChatVariablePanel).toBe(true)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
  })

  it('stays disabled without mutating panel state', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<ChatVariableButton disabled />, {
      initialStoreState: {
        showChatVariablePanel: false,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.chatVariable.panelTitle' }))

    expect(screen.getByRole('button')).toBeDisabled()
    expect(store.getState().showChatVariablePanel).toBe(false)
  })
})
