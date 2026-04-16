import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import EnvButton from '../env-button'

const mockCloseAllInputFieldPanels = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

describe('EnvButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the environment panel and close the other panels when clicked', () => {
    const { store } = renderWorkflowComponent(<EnvButton disabled={false} />, {
      initialStoreState: {
        showChatVariablePanel: true,
        showGlobalVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    fireEvent.click(screen.getByRole('button'))

    expect(store.getState().showEnvPanel).toBe(true)
    expect(store.getState().showChatVariablePanel).toBe(false)
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
  })

  it('should apply the same active styles as the view history icon button when the environment panel is visible', () => {
    renderWorkflowComponent(<EnvButton disabled={false} />, {
      initialStoreState: {
        showEnvPanel: true,
      },
    })

    const button = screen.getByRole('button')
    const icon = button.querySelector('svg')

    expect(button).toHaveAttribute('aria-label', 'workflow.env.envPanelTitle')
    expect(button).toHaveClass('bg-state-accent-hover')
    expect(icon).toHaveClass('text-components-button-secondary-accent-text')
  })

  it('should keep the button disabled when the disabled prop is true', () => {
    const { store } = renderWorkflowComponent(<EnvButton disabled />, {
      initialStoreState: {
        showEnvPanel: false,
      },
    })

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toBeDisabled()
    expect(store.getState().showEnvPanel).toBe(false)
    expect(mockCloseAllInputFieldPanels).not.toHaveBeenCalled()
  })
})
