import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import ChatVariableButton from '../chat-variable-button'

let mockTheme: 'light' | 'dark' = 'light'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

describe('ChatVariableButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'light'
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

  it('applies the active dark theme styles when the chat variable panel is visible', () => {
    mockTheme = 'dark'
    renderWorkflowComponent(<ChatVariableButton disabled={false} />, {
      initialStoreState: {
        showChatVariablePanel: true,
      },
    })

    expect(screen.getByRole('button')).toHaveClass('border-black/5', 'bg-white/10', 'backdrop-blur-sm')
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
