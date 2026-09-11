import type { Condition } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import ConditionItem from '../components/condition-list/condition-item'
import { ComparisonOperator } from '../types'

vi.mock('@/app/components/workflow/panel/chat-variable-panel/components/bool-value', () => ({
  default: ({ value }: { value: boolean }) => <div data-testid="bool-value">{String(value)}</div>,
}))

vi.mock('../components/condition-list/condition-input', () => ({
  default: () => <div />,
}))

vi.mock('../components/condition-list/condition-operator', () => ({
  default: () => <div />,
}))

vi.mock('../components/condition-list/condition-var-selector', () => ({
  default: ({
    onChange,
  }: {
    onChange: (selector: string[], variable: { type: string }) => void
  }) => (
    <button type="button" onClick={() => onChange(['source', 'flag'], { type: 'boolean' })}>
      Select boolean variable
    </button>
  ),
}))

const renderConditionItem = (condition: Condition, onUpdateCondition = vi.fn()) => {
  const result = render(
    <ConditionItem
      conditionId={condition.id}
      condition={condition}
      onUpdateCondition={onUpdateCondition}
      nodeId="loop-node"
      availableNodes={[]}
      numberVariables={[]}
      availableVars={[]}
    />,
  )

  return { ...result, onUpdateCondition }
}

describe('ConditionItem', () => {
  it.each([
    { value: 'false', expected: 'false' },
    { value: 'true', expected: 'true' },
  ] as const)('should render legacy boolean string $value as $expected', ({ value, expected }) => {
    renderConditionItem({
      id: 'condition-1',
      varType: VarType.boolean,
      variable_selector: ['source', 'flag'],
      comparison_operator: ComparisonOperator.is,
      value,
    })

    expect(screen.getByTestId('bool-value')).toHaveTextContent(expected)
  })

  it('should reset the value to boolean false when selecting a boolean variable', async () => {
    const user = userEvent.setup()
    const { onUpdateCondition } = renderConditionItem({
      id: 'condition-1',
      varType: VarType.string,
      variable_selector: ['source', 'text'],
      comparison_operator: ComparisonOperator.contains,
      value: '',
    })

    await user.click(screen.getByRole('button', { name: 'Select boolean variable' }))

    expect(onUpdateCondition).toHaveBeenCalledWith(
      'condition-1',
      expect.objectContaining({
        varType: VarType.boolean,
        variable_selector: ['source', 'flag'],
        comparison_operator: ComparisonOperator.is,
        value: false,
      }),
    )
  })
})
