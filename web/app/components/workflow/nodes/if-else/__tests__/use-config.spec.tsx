import type { IfElseNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { ComparisonOperator, LogicalOperator } from '../types'
import useConfig from '../use-config'
const createPayload = (overrides: Partial<IfElseNodeType> = {}): IfElseNodeType => ({
  title: 'If Else',
  desc: '',
  type: BlockEnum.IfElse,
  isInIteration: false,
  isInLoop: false,
  cases: [
    {
      case_id: 'case-1',
      logical_operator: LogicalOperator.and,
      conditions: [
        {
          id: 'condition-1',
          varType: VarType.string,
          variable_selector: ['node-1', 'answer'],
          comparison_operator: ComparisonOperator.contains,
          value: 'hello',
        },
      ],
    },
  ],
  _targetBranches: [
    { id: 'case-1', name: 'IF' },
    { id: 'false', name: 'ELSE' },
  ],
  ...overrides,
})

describe('if-else/use-config', () => {
  it('persists condition edits, case ordering and removes only the deleted branch edges', () => {
    const payload = createPayload()
    const { result } = renderNodeConfig(useConfig, payload, {
      nodes: [createNode({ id: 'node', data: payload }), createNode({ id: 'target' })],
      edges: [createEdge({ id: 'kept', source: 'node', target: 'target', sourceHandle: 'false' })],
    })
    act(() => result.current.config.handleAddCase())
    const added = result.current.config.inputs.cases[1]!
    act(() =>
      result.current.flow.addEdges(
        createEdge({
          id: 'removed',
          source: 'node',
          target: 'target',
          sourceHandle: added.case_id,
        }),
      ),
    )
    act(() =>
      result.current.config.handleAddCondition('case-1', ['start', 'score'], {
        variable: 'score',
        type: VarType.number,
      }),
    )
    const condition = result.current.config.inputs.cases[0]!.conditions[1]!
    act(() =>
      result.current.config.handleUpdateCondition('case-1', condition.id, {
        ...condition,
        comparison_operator: ComparisonOperator.largerThan,
        value: '3',
      }),
    )
    act(() => result.current.config.handleRemoveCondition('case-1', 'condition-1'))
    act(() => result.current.config.handleToggleConditionLogicalOperator('case-1'))
    const first = result.current.config.inputs.cases[0]!
    act(() =>
      result.current.config.handleSortCase([
        { ...added, id: added.case_id },
        { ...first, id: first.case_id },
      ]),
    )
    expect(result.current.flow.getNode('node')?.data._targetBranches).toEqual([
      { id: added.case_id, name: 'CASE 1' },
      { id: 'case-1', name: 'CASE 2' },
      { id: 'false', name: 'ELSE' },
    ])
    act(() => result.current.config.handleRemoveCase(added.case_id))
    expect(result.current.flow.getNode('node')?.data.cases).toMatchObject([
      {
        case_id: 'case-1',
        logical_operator: LogicalOperator.or,
        conditions: [
          { ...condition, comparison_operator: ComparisonOperator.largerThan, value: '3' },
        ],
      },
    ])
    expect(result.current.flow.getEdges().map((edge) => edge.id)).toEqual(['kept'])
  })
  it('persists file subconditions through add, update, removal and logical toggle', () => {
    const payload = createPayload({
      cases: [
        {
          case_id: 'case-1',
          logical_operator: LogicalOperator.and,
          conditions: [
            {
              id: 'condition-1',
              varType: VarType.file,
              variable_selector: ['node-1', 'files'],
              comparison_operator: ComparisonOperator.exists,
              value: '',
              sub_variable_condition: {
                case_id: 'sub-case-1',
                logical_operator: LogicalOperator.and,
                conditions: [
                  {
                    id: 'sub-1',
                    key: 'name',
                    varType: VarType.string,
                    comparison_operator: ComparisonOperator.contains,
                    value: '',
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const { result } = renderNodeConfig(useConfig, payload)
    act(() => result.current.config.handleAddSubVariableCondition('case-1', 'condition-1', 'name'))
    const added =
      result.current.config.inputs.cases[0]!.conditions[0]!.sub_variable_condition!.conditions[1]!
    act(() =>
      result.current.config.handleUpdateSubVariableCondition('case-1', 'condition-1', added.id, {
        ...added,
        key: 'size',
        comparison_operator: ComparisonOperator.is,
        value: '2',
      }),
    )
    act(() =>
      result.current.config.handleRemoveSubVariableCondition('case-1', 'condition-1', 'sub-1'),
    )
    act(() =>
      result.current.config.handleToggleSubVariableConditionLogicalOperator(
        'case-1',
        'condition-1',
      ),
    )
    expect(
      result.current.flow.getNode('node')?.data.cases[0].conditions[0].sub_variable_condition,
    ).toEqual({
      case_id: 'sub-case-1',
      logical_operator: LogicalOperator.or,
      conditions: [
        { ...added, key: 'size', comparison_operator: ComparisonOperator.is, value: '2' },
      ],
    })
  })
})
