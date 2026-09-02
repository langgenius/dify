import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import VariableInspectPanel from '../index'

vi.mock('../panel', () => ({
  default: () => <h2>workflow.debug.variableInspect.title</h2>,
}))

describe('variable inspect index', () => {
  it('renders nothing when the inspect panel is hidden', () => {
    const { container } = renderWorkflowComponent(<VariableInspectPanel />, {
      initialStoreState: {
        showVariableInspectPanel: false,
      },
    })

    expect(container).toBeEmptyDOMElement()
  })

  it('focuses the named region when the inspect panel opens', () => {
    renderWorkflowComponent(<VariableInspectPanel />, {
      initialStoreState: {
        showVariableInspectPanel: true,
      },
    })

    expect(
      screen.getByRole('region', { name: 'workflow.debug.variableInspect.title' }),
    ).toHaveFocus()
  })

  it('resizes the inspect panel from the keyboard-accessible separator', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<VariableInspectPanel />, {
      initialStoreState: {
        showVariableInspectPanel: true,
        variableInspectPanelHeight: 320,
        workflowCanvasHeight: 600,
      },
    })
    const separator = screen.getByRole('separator', {
      name: 'workflow.debug.variableInspect.title',
    })

    separator.focus()
    await user.keyboard('{ArrowUp}')

    await waitFor(() => expect(store.getState().variableInspectPanelHeight).toBe(330))
    expect(separator).toHaveAttribute('aria-valuenow', '330')
  })
})
