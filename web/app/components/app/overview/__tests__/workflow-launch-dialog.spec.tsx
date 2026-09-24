import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { render } from '@/test/console/render'
import { WorkflowLaunchDialog } from '../workflow-launch-dialog'

const hiddenVariables = [
  {
    default: 'initial',
    hide: true,
    label: 'Secret',
    required: true,
    type: InputVarType.textInput,
    variable: 'secret',
  },
]

describe('WorkflowLaunchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the workflow with entered hidden values and closes the dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null)

    render(
      <WorkflowLaunchDialog
        hiddenVariables={hiddenVariables}
        open
        targetUrl="https://example.test/workflow"
        onOpenChange={onOpenChange}
      />,
    )

    const input = screen.getByLabelText('Secret')
    await user.clear(input)
    await user.type(input, 'entered value')
    await user.click(screen.getByRole('button', { name: /overview\.appInfo\.launch/i }))

    await waitFor(() => {
      expect(openWindow).toHaveBeenCalledWith(
        'https://example.test/workflow?secret=entered+value',
        '_blank',
      )
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('resets hidden values when the controlled dialog is reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <WorkflowLaunchDialog
        hiddenVariables={hiddenVariables}
        open
        targetUrl="https://example.test/workflow"
        onOpenChange={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Secret')
    await user.clear(input)
    await user.type(input, 'changed')
    expect(input).toHaveValue('changed')

    rerender(
      <WorkflowLaunchDialog
        hiddenVariables={hiddenVariables}
        open={false}
        targetUrl="https://example.test/workflow"
        onOpenChange={vi.fn()}
      />,
    )
    rerender(
      <WorkflowLaunchDialog
        hiddenVariables={hiddenVariables}
        open
        targetUrl="https://example.test/workflow"
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Secret')).toHaveValue('initial')
  })

  it('renders nothing when there are no hidden variables', () => {
    const { container } = render(
      <WorkflowLaunchDialog
        hiddenVariables={[]}
        open
        targetUrl="https://example.test/workflow"
        onOpenChange={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
