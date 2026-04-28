import type { VariableAssignerNodeType } from '../../../types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import AddVariable from '../index'

const mockHandleAssignVariableValueChange = vi.fn()

vi.mock('../../../hooks', () => ({
  useVariableAssigner: () => ({
    handleAssignVariableValueChange: mockHandleAssignVariableValueChange,
  }),
}))

const availableVars: NodeOutPutVar[] = [{
  nodeId: 'node-source',
  title: 'Source Node',
  vars: [{
    variable: 'answer',
    type: VarType.string,
  }],
}]

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

    const trigger = container.querySelector('div[class*="group/addvariable"]')
    fireEvent.click(trigger as HTMLElement)

    expect(screen.getByText('workflow.nodes.variableAssigner.setAssignVariable')).toBeInTheDocument()

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
})
