import type { VariableAssignerNodeType } from '../../../types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import AddVariable from '../index'

const mockHandleAssignVariableValueChange = vi.fn()

vi.mock('../../../hooks', () => ({
  useVariableAssigner: () => ({
    handleAssignVariableValueChange: mockHandleAssignVariableValueChange,
  }),
}))

const availableVars: NodeOutPutVar[] = [
  {
    nodeId: 'node-source',
    title: 'Source Node',
    vars: [
      {
        variable: 'answer',
        type: VarType.string,
      },
    ],
  },
]

const nodeData: VariableAssignerNodeType = {
  title: 'Variable Assigner',
  desc: '',
  type: 'variable-assigner' as VariableAssignerNodeType['type'],
  output_type: VarType.any,
  variables: [],
  advanced_settings: {
    group_enabled: false,
    groups: [],
  },
}

describe('variable-assigner/add-variable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the real popup and assigns the selected variable', () => {
    const { container } = render(
      <AddVariable
        availableVars={availableVars}
        variableAssignerNodeId="node-target"
        variableAssignerNodeData={nodeData}
        handleId="group-1"
      />,
    )

    const triggerButton = container.querySelector('button')!
    const triggerVisual = triggerButton.firstElementChild!
    expect(triggerButton).not.toHaveAttribute('data-popup-open')

    fireEvent.click(triggerButton)

    expect(triggerButton).toHaveAttribute('data-popup-open', '')
    expect(triggerVisual).toHaveClass('bg-primary-600!')

    expect(
      screen.getByText('workflowLogic.nodes.variableAssigner.setAssignVariable'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByText('answer'))

    expect(mockHandleAssignVariableValueChange).toHaveBeenCalledWith(
      'node-target',
      ['node-source', 'answer'],
      expect.objectContaining<Partial<Var>>({
        variable: 'answer',
        type: VarType.string,
      }),
      'group-1',
    )
  })

  it('assigns the highlighted variable from the focused popup without handling outside keys', async () => {
    const user = userEvent.setup()
    render(
      <>
        <input aria-label="Outside" />
        <AddVariable
          availableVars={[
            {
              ...availableVars[0]!,
              vars: [...availableVars[0]!.vars, { variable: 'second', type: VarType.string }],
            },
          ]}
          variableAssignerNodeId="node-target"
          variableAssignerNodeData={nodeData}
        />
      </>,
    )

    await user.click(screen.getByRole('button'))
    const popup = screen.getByRole('dialog')
    expect(popup).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(mockHandleAssignVariableValueChange).toHaveBeenCalledWith(
      'node-target',
      ['node-source', 'second'],
      expect.objectContaining({ variable: 'second' }),
      undefined,
    )
    await user.click(screen.getByRole('textbox', { name: 'Outside' }))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(mockHandleAssignVariableValueChange).toHaveBeenCalledTimes(1)
  })
})
