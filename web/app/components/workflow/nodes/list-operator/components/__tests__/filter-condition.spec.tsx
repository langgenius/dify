import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '../../../../types'
import { ComparisonOperator } from '../../../if-else/types'
import FilterCondition from '../filter-condition'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({
    availableVars: [],
    availableNodesWithParent: [],
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

vi.mock('../../../../panel/chat-variable-panel/components/bool-value', () => ({
  default: ({ value, onChange }: { value: boolean, onChange: (value: boolean) => void }) => (
    <button onClick={() => onChange(!value)}>{value ? 'true' : 'false'}</button>
  ),
}))

vi.mock('../../../if-else/components/condition-list/condition-operator', () => ({
  default: ({
    value,
    onSelect,
  }: {
    value: string
    onSelect: (value: string) => void
  }) => (
    <button onClick={() => onSelect(ComparisonOperator.notEqual)}>
      operator:
      {value}
    </button>
  ),
}))

vi.mock('../sub-variable-picker', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <button onClick={() => onChange('size')}>
      sub-variable:
      {value}
    </button>
  ),
}))

describe('FilterCondition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a select input for array-backed file conditions', () => {
    render(
      <FilterCondition
        condition={{
          key: 'type',
          comparison_operator: ComparisonOperator.in,
          value: ['document'],
        }}
        varType={VarType.file}
        onChange={vi.fn()}
        hasSubVariable
        readOnly={false}
        nodeId="node-1"
      />,
    )

    expect(screen.getByText(/operator:/)).toBeInTheDocument()
    expect(screen.getByText(/sub-variable:/)).toBeInTheDocument()
  })

  it('should render a boolean value control for boolean variables', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FilterCondition
        condition={{
          key: 'enabled',
          comparison_operator: ComparisonOperator.equal,
          value: false,
        }}
        varType={VarType.boolean}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'false' }))

    expect(onChange).toHaveBeenCalledWith({
      key: 'enabled',
      comparison_operator: ComparisonOperator.equal,
      value: true,
    })
  })

  it('should reset operator and value when the sub variable changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FilterCondition
        condition={{
          key: '',
          comparison_operator: ComparisonOperator.equal,
          value: '',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'sub-variable:' }))

    expect(onChange).toHaveBeenCalledWith({
      key: 'size',
      comparison_operator: ComparisonOperator.largerThan,
      value: '',
    })
  })
})
