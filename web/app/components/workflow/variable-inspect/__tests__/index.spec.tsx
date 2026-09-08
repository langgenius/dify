import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import VariableInspectPanel from '../index'

vi.mock('../panel', () => ({ default: () => <div>Variables</div> }))

describe('variable inspect index', () => {
  it('grows upward with the keyboard and persists its height', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<VariableInspectPanel />, {
      initialStoreState: {
        showVariableInspectPanel: true,
        variableInspectPanelHeight: 200,
        workflowCanvasHeight: 500,
      },
    })
    await user.tab()
    const handle = screen.getByRole('separator', { name: 'workflow.debug.variableInspect.title' })
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowUp}{Shift>}{ArrowUp}{/Shift}')
    expect(handle).toHaveAttribute('aria-valuenow', '240')
    await waitFor(() =>
      expect(localStorage.getItem('workflow-variable-inpsect-panel-height')).toBe('240'),
    )
    await user.keyboard('{End}{ArrowUp}')
    expect(handle).toHaveAttribute('aria-valuenow', '440')
    await user.keyboard('{Home}{ArrowDown}')
    expect(handle).toHaveAttribute('aria-valuenow', '120')
  })

  it('renders nothing when the inspect panel is hidden', () => {
    const { container } = renderWorkflowComponent(<VariableInspectPanel />, {
      initialStoreState: {
        showVariableInspectPanel: false,
      },
    })

    expect(container).toBeEmptyDOMElement()
  })
})
