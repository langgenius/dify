import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { ComparisonOperator } from '../../types'
import ConditionValue from '../condition-value'

vi.mock('reactflow', () => ({ useNodes: () => [] }))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInText: () => <span>Selected variable</span>,
}))

const renderValue = (value: unknown, operator: ComparisonOperator = ComparisonOperator.equal) =>
  render(
    <ConditionValue
      variableSelector={['node-1', 'answer']}
      operator={operator}
      value={value as ComponentProps<typeof ConditionValue>['value']}
    />,
  )

describe('ConditionValue', () => {
  it.each([
    [0, '0'],
    [42, '42'],
    [-1.5, '-1.5'],
    [false, 'False'],
    [true, 'True'],
    ['Answer {{#node-1.answer#}} {{#sys.query#}}', 'Answer {{answer}} {{sys.query}}'],
    [['remote_url'], 'remote_url'],
  ])('displays persisted primitive value %j as %s', (value, displayed) => {
    renderValue(value)
    expect(screen.getByText(displayed)).toBeInTheDocument()
  })

  it.each([{ value: null }, { value: undefined }, { value: {} }, { value: [] }, { value: [{}] }])(
    'renders malformed legacy value $value as empty',
    ({ value }) => {
      const { container } = renderValue(value)
      expect(container.textContent).toBe('Selected variable=')
    },
  )

  it('keeps transfer method array labels localized', () => {
    renderValue(['remote_url'], ComparisonOperator.in)
    expect(screen.getByText('workflowLogic.nodes.ifElse.optionName.url')).toBeInTheDocument()
  })

  it('omits a value for a value-free operator', () => {
    renderValue(42, ComparisonOperator.empty)
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(
      screen.getByText('workflowLogic.nodes.ifElse.comparisonOperator.empty'),
    ).toBeInTheDocument()
  })
})
