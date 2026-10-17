import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import EnvButton from '../env-button'

const mockCloseAllInputFieldPanels = vi.fn()

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/app/components/rag-pipeline/hooks/use-input-field-panel', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

describe('EnvButton', () => {
  it('should open the environment panel and close the other panels when clicked', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<EnvButton disabled={false} />, {
      initialStoreState: {
        showChatVariablePanel: true,
        showGlobalVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' }))

    expect(store.getState().showEnvPanel).toBe(true)
    expect(store.getState().showChatVariablePanel).toBe(false)
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
  })

  it('should keep the button disabled when the disabled prop is true', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<EnvButton disabled />, {
      initialStoreState: {
        showEnvPanel: false,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' }))

    expect(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' })).toBeDisabled()
    expect(store.getState().showEnvPanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).not.toHaveBeenCalled()
  })
})
