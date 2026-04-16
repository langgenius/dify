import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import GlobalVariableButton from '../global-variable-button'

const mockCloseAllInputFieldPanels = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

describe('GlobalVariableButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the global variable panel and close the other panels when clicked', () => {
    const { store } = renderWorkflowComponent(<GlobalVariableButton disabled={false} />, {
      initialStoreState: {
        showEnvPanel: true,
        showChatVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    fireEvent.click(screen.getByRole('button'))

    expect(store.getState().showGlobalVariablePanel).toBe(true)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().showChatVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
  })

  it('should keep the button disabled when the disabled prop is true', () => {
    const { store } = renderWorkflowComponent(<GlobalVariableButton disabled />, {
      initialStoreState: {
        showGlobalVariablePanel: false,
      },
    })

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toBeDisabled()
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).not.toHaveBeenCalled()
  })
})
