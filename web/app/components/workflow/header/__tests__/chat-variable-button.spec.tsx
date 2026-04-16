import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import ChatVariableButton from '../chat-variable-button'

describe('ChatVariableButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the chat variable panel and closes the other workflow panels', () => {
    const { store } = renderWorkflowComponent(<ChatVariableButton disabled={false} />, {
      initialStoreState: {
        showEnvPanel: true,
        showGlobalVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    fireEvent.click(screen.getByRole('button'))

    expect(store.getState().showChatVariablePanel).toBe(true)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
  })

  it('applies the same active styles as the view history icon button when the chat variable panel is visible', () => {
    renderWorkflowComponent(<ChatVariableButton disabled={false} />, {
      initialStoreState: {
        showChatVariablePanel: true,
      },
    })

    const button = screen.getByRole('button')
    const icon = button.querySelector('svg')

    expect(button).toHaveAttribute('aria-label', 'workflow.chatVariable.panelTitle')
    expect(button).toHaveClass('bg-state-accent-hover')
    expect(icon).toHaveClass('text-components-button-secondary-accent-text')
  })

  it('stays disabled without mutating panel state', () => {
    const { store } = renderWorkflowComponent(<ChatVariableButton disabled />, {
      initialStoreState: {
        showChatVariablePanel: false,
      },
    })

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toBeDisabled()
    expect(store.getState().showChatVariablePanel).toBe(false)
  })
})
