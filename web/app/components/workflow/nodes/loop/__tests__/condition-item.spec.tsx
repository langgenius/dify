import type { Condition } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarType } from '@/app/components/workflow/types'
import ConditionItem from '../components/condition-list/condition-item'
import { ComparisonOperator } from '../types'

const renderConditionItem = (condition: Condition, onUpdateCondition = vi.fn()) => {
  const result = render(
    <ReactFlowProvider>
      <ConditionItem
        conditionId={condition.id}
        condition={condition}
        onUpdateCondition={onUpdateCondition}
        nodeId="loop-node"
        availableNodes={[createNode({ id: 'source', data: { title: 'Source' } })]}
        numberVariables={[]}
        availableVars={[
          {
            nodeId: 'source',
            title: 'Source',
            vars: [{ variable: 'flag', type: VarType.boolean }],
          },
        ]}
      />
    </ReactFlowProvider>,
  )

  return { ...result, onUpdateCondition }
}

describe('ConditionItem', () => {
  it.each([
    { value: 'false', expected: 'false' },
    { value: 'true', expected: 'true' },
  ] as const)(
    'should render legacy boolean string $value as $expected',
    async ({ value, expected }) => {
      const user = userEvent.setup()
      const { onUpdateCondition } = renderConditionItem({
        id: 'condition-1',
        varType: VarType.boolean,
        variable_selector: ['source', 'flag'],
        comparison_operator: ComparisonOperator.is,
        value,
      })

      await user.click(screen.getByText(expected === 'true' ? 'True' : 'False'))
      expect(onUpdateCondition).not.toHaveBeenCalled()
      await user.click(screen.getByText(expected === 'true' ? 'False' : 'True'))
      expect(onUpdateCondition).toHaveBeenCalledWith(
        'condition-1',
        expect.objectContaining({ value: expected !== 'true' }),
      )
    },
  )

  it('should reset the value to boolean false when selecting a boolean variable', async () => {
    const user = userEvent.setup()
    const { onUpdateCondition } = renderConditionItem({
      id: 'condition-1',
      varType: VarType.string,
      variable_selector: ['source', 'text'],
      comparison_operator: ComparisonOperator.contains,
      value: '',
    })

    await user.click(screen.getByText('text'))
    await user.click(await screen.findByText('flag'))

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
