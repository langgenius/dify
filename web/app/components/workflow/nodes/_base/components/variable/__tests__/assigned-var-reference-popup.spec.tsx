import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import AssignedVarReferencePopup from '../assigned-var-reference-popup'

const mockVarReferenceVars = vi.fn()

vi.mock('../var-reference-vars', () => ({
  default: ({
    vars,
    onChange,
    itemWidth,
    isSupportFileVar,
  }: {
    vars: NodeOutPutVar[]
    onChange: (value: ValueSelector, item: Var) => void
    itemWidth?: number
    isSupportFileVar?: boolean
  }) => {
    mockVarReferenceVars({ vars, onChange, itemWidth, isSupportFileVar })
    return <div data-testid="var-reference-vars">{vars.length}</div>
  },
}))

const createOutputVar = (overrides: Partial<NodeOutPutVar> = {}): NodeOutPutVar => ({
  nodeId: 'node-1',
  title: 'Node One',
  vars: [{
    variable: 'answer',
    type: VarType.string,
  }],
  ...overrides,
})

describe('AssignedVarReferencePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the empty state when there are no assigned variables', () => {
    render(
      <AssignedVarReferencePopup
        vars={[]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.nodes.assigner.noAssignedVars')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.assignedVarsDescription')).toBeInTheDocument()
    expect(screen.queryByTestId('var-reference-vars')).not.toBeInTheDocument()
  })

  it('should delegate populated variable lists to the variable picker with file support enabled', () => {
    const onChange = vi.fn()

    render(
      <AssignedVarReferencePopup
        vars={[createOutputVar()]}
        itemWidth={280}
        onChange={onChange}
      />,
    )

    expect(screen.getByTestId('var-reference-vars')).toHaveTextContent('1')
    expect(mockVarReferenceVars).toHaveBeenCalledWith({
      vars: [createOutputVar()],
      onChange,
      itemWidth: 280,
      isSupportFileVar: true,
    })
  })
})
