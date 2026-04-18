import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { VarType } from '../../../../types'
import { ComparisonOperator } from '../../../if-else/types'
import FilterCondition from '../filter-condition'

const { mockUseAvailableVarList } = vi.hoisted(() => ({
  mockUseAvailableVarList: vi.fn((_nodeId: string, _options: unknown) => ({
    availableVars: [],
    availableNodesWithParent: [],
  })),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (nodeId: string, options: unknown) => mockUseAvailableVarList(nodeId, options),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({
    value,
    onChange,
    onFocusChange,
    readOnly,
    placeholder,
    className,
  }: {
    value: string
    onChange: (value: string) => void
    onFocusChange?: (value: boolean) => void
    readOnly?: boolean
    placeholder?: string
    className?: string
  }) => (
    <input
      aria-label="variable-input"
      className={className}
      value={value}
      onChange={e => onChange(e.target.value)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      readOnly={readOnly}
      placeholder={placeholder}
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
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [],
      availableNodesWithParent: [],
    })
  })

  it('should render a select input for array-backed file conditions and update array values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FilterCondition
        condition={{
          key: 'type',
          comparison_operator: ComparisonOperator.in,
          value: ['document'],
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable
        readOnly={false}
        nodeId="node-1"
      />,
    )

    expect(screen.getByText(/operator:/)).toBeInTheDocument()
    expect(screen.getByText(/sub-variable:/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.ifElse.optionName.doc' }))
    await user.click(screen.getByText('workflow.nodes.ifElse.optionName.image'))

    expect(onChange).toHaveBeenCalledWith({
      key: 'type',
      comparison_operator: ComparisonOperator.in,
      value: ['image'],
    })
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

  it('should render a supported variable input, apply focus styles, and filter vars by expected type', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FilterCondition
        condition={{
          key: 'name',
          comparison_operator: ComparisonOperator.equal,
          value: 'draft',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    const variableInput = screen.getByRole('textbox', { name: 'variable-input' })
    expect(variableInput).toHaveAttribute('placeholder', 'workflow.nodes.http.insertVarPlaceholder')

    await user.click(variableInput)
    expect(variableInput.className).toContain('border-components-input-border-active')

    fireEvent.change(variableInput, { target: { value: 'draft next' } })
    expect(onChange).toHaveBeenLastCalledWith({
      key: 'name',
      comparison_operator: ComparisonOperator.equal,
      value: 'draft next',
    })

    const config = mockUseAvailableVarList.mock.calls[0]?.[1] as unknown as {
      filterVar: (varPayload: { type: VarType }) => boolean
    }
    expect(config.filterVar({ type: VarType.string })).toBe(true)
    expect(config.filterVar({ type: VarType.number })).toBe(false)
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

  it('should render fallback inputs for unsupported keys and hide value inputs for no-value operators', async () => {
    const onChange = vi.fn()

    const { rerender } = render(
      <FilterCondition
        condition={{
          key: 'custom_field',
          comparison_operator: ComparisonOperator.equal,
          value: '',
        }}
        varType={VarType.number}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    const numberInput = screen.getByRole('spinbutton')
    fireEvent.change(numberInput, { target: { value: '42' } })

    expect(onChange).toHaveBeenLastCalledWith({
      key: 'custom_field',
      comparison_operator: ComparisonOperator.equal,
      value: '42',
    })

    rerender(
      <FilterCondition
        condition={{
          key: 'custom_field',
          comparison_operator: ComparisonOperator.empty,
          value: '',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'variable-input' })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('should build transfer-method options and keep empty select option lists stable for unsupported keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const { rerender } = render(
      <FilterCondition
        condition={{
          key: 'transfer_method',
          comparison_operator: ComparisonOperator.in,
          value: ['local_file'],
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.ifElse.optionName.localUpload' }))
    await user.click(screen.getByText('workflow.nodes.ifElse.optionName.url'))
    expect(onChange).toHaveBeenCalledWith({
      key: 'transfer_method',
      comparison_operator: ComparisonOperator.in,
      value: [TransferMethod.remote_url],
    })

    rerender(
      <FilterCondition
        condition={{
          key: 'custom_field',
          comparison_operator: ComparisonOperator.in,
          value: '',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    expect(screen.getByRole('button', { name: 'Select value' })).toBeInTheDocument()
  })
})
