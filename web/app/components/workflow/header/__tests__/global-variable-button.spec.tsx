import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import GlobalVariableButton from '../global-variable-button'

const mockCloseAllInputFieldPanels = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks/use-input-field-panel', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

describe('GlobalVariableButton', () => {
  it('should open the global variable panel and close the other panels when clicked', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<GlobalVariableButton disabled={false} />, {
      initialStoreState: {
        showEnvPanel: true,
        showChatVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.globalVar.title' }))

    expect(store.getState().showGlobalVariablePanel).toBe(true)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().showChatVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
  })

  it('should keep the button disabled when the disabled prop is true', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<GlobalVariableButton disabled />, {
      initialStoreState: {
        showGlobalVariablePanel: false,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.globalVar.title' }))

    expect(screen.getByRole('button', { name: 'workflow.globalVar.title' })).toBeDisabled()
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).not.toHaveBeenCalled()
  })
})
