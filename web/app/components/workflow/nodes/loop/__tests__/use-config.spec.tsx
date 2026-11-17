import type { LoopNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, ErrorHandleMode, ValueType, VarType } from '../../../types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { ComparisonOperator, LogicalOperator } from '../types'
import useConfig from '../use-config'
const createPayload = (overrides: Partial<LoopNodeType> = {}): LoopNodeType => ({
  title: 'Loop',
  desc: '',
  type: BlockEnum.Loop,
  start_node_id: 'start-node',
  loop_id: 'loop-node',
  logical_operator: LogicalOperator.and,
  break_conditions: [
    {
      id: 'condition-1',
      varType: VarType.string,
      variable_selector: ['node-1', 'answer'],
      comparison_operator: ComparisonOperator.contains,
      value: 'hello',
    },
  ],
  loop_count: 3,
  error_handle_mode: ErrorHandleMode.ContinueOnError,
  loop_variables: [
    {
      id: 'loop-var-1',
      label: 'item',
      var_type: VarType.string,
      value_type: ValueType.constant,
      value: 'value',
    },
  ],
  ...overrides,
})
const setup = (data = createPayload()) => renderNodeConfig(useConfig, data, { nodeId: 'loop-node' })
it('derives loop variables from the actual loop node', () => {
  const { result } = setup()
  expect(result.current.config.childrenNodeVars).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'loop-node',
        vars: [
          expect.objectContaining({ variable: 'item', type: VarType.string, isLoopVariable: true }),
        ],
      }),
    ]),
  )
  expect(
    result.current.config.filterInputVar({ variable: 'items', type: VarType.arrayNumber }),
  ).toBe(true)
  expect(result.current.config.filterInputVar({ variable: 'text', type: VarType.string })).toBe(
    false,
  )
})
it('persists condition and error policy edits without restoring removed conditions', () => {
  const { result } = setup()
  act(() => result.current.config.changeErrorResponseMode({ value: ErrorHandleMode.Terminated }))
  act(() =>
    result.current.config.handleAddCondition(['source', 'score'], {
      variable: 'score',
      type: VarType.number,
    }),
  )
  const added = result.current.config.inputs.break_conditions!.find(
    (condition) => condition.id !== 'condition-1',
  )!
  act(() =>
    result.current.config.handleUpdateCondition(added.id, {
      ...added,
      comparison_operator: ComparisonOperator.largerThan,
      value: '3',
    }),
  )
  act(() => result.current.config.handleRemoveCondition('condition-1'))
  act(() => result.current.config.handleToggleConditionLogicalOperator())
  expect(result.current.flow.getNode('loop-node')?.data).toEqual(
    expect.objectContaining({
      error_handle_mode: ErrorHandleMode.Terminated,
      logical_operator: LogicalOperator.or,
      break_conditions: [
        expect.objectContaining({
          id: added.id,
          value: '3',
          comparison_operator: ComparisonOperator.largerThan,
        }),
      ],
    }),
  )
})
it('persists added, renamed and removed loop variables together with the loop count', () => {
  const { result } = setup()
  act(() => result.current.config.handleAddLoopVariable())
  const added = result.current.config.inputs.loop_variables!.find(
    (variable) => variable.id !== 'loop-var-1',
  )!
  act(() => result.current.config.handleUpdateLoopVariable(added.id, { label: 'updated' }))
  act(() => result.current.config.handleRemoveLoopVariable('loop-var-1'))
  act(() => result.current.config.handleUpdateLoopCount(5))
  expect(result.current.flow.getNode('loop-node')?.data).toEqual(
    expect.objectContaining({
      loop_count: 5,
      loop_variables: [
        expect.objectContaining({ id: added.id, label: 'updated', value_type: ValueType.constant }),
      ],
    }),
  )
})
it('updates file subconditions through the real condition helpers', () => {
  const { result } = setup(
    createPayload({
      break_conditions: [
        {
          id: 'file',
          varType: VarType.arrayFile,
          variable_selector: ['source', 'files'],
          comparison_operator: ComparisonOperator.contains,
          value: '',
          sub_variable_condition: { logical_operator: LogicalOperator.and, conditions: [] },
        },
      ],
    }),
  )
  act(() => result.current.config.handleAddSubVariableCondition('file', 'name'))
  const added =
    result.current.config.inputs.break_conditions![0]!.sub_variable_condition!.conditions[0]!
  act(() =>
    result.current.config.handleUpdateSubVariableCondition('file', added.id, {
      ...added,
      value: 'report',
    }),
  )
  act(() => result.current.config.handleToggleSubVariableConditionLogicalOperator('file'))
  expect(result.current.config.inputs.break_conditions![0]!.sub_variable_condition).toEqual(
    expect.objectContaining({
      logical_operator: LogicalOperator.or,
      conditions: [expect.objectContaining({ value: 'report' })],
    }),
  )
  act(() => result.current.config.handleRemoveSubVariableCondition('file', added.id))
  expect(
    result.current.config.inputs.break_conditions![0]!.sub_variable_condition!.conditions,
  ).toEqual([])
})
