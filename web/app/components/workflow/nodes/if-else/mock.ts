import type { IfElseType } from './types'
import { ComparisonOperator, LogicalOperator } from './types'

export const mockData: IfElseType = {
  title: 'Test',
  desc: 'Test',
  type: 'Test',
  logical_operator: LogicalOperator.and,
  conditions: [
    {
      id: '1',
      variable_selector: ['aaa', 'name'],
      comparison_operator: ComparisonOperator.contains,
      value: '22',
    },
    {
      id: '2',
      variable_selector: ['bbb', 'b', 'c'],
      comparison_operator: ComparisonOperator.equal,
      value: 'b',
    },
  ],
}
