import type { IfElseNodeType } from '../types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { LogicalOperator } from '../types'
import {
  addCase,
  addCondition,
  addSubVariableCondition,
  filterAllVars,
  filterNumberVars,
  getVarsIsVarFileAttribute,
  removeCase,
  removeCondition,
  removeSubVariableCondition,
  sortCases,
  toggleConditionLogicalOperator,
  toggleSubVariableConditionLogicalOperator,
  updateCondition,
  updateSubVariableCondition,
} from '../use-config.helpers'

type TestIfElseInputs = ReturnType<typeof createInputs>

const createInputs = (): IfElseNodeType => ({
  title: 'If/Else',
  desc: '',
  type: BlockEnum.IfElse,
  cases: [{
    case_id: 'case-1',
    logical_operator: LogicalOperator.and,
    conditions: [{
      id: 'condition-1',
      varType: VarType.string,
      variable_selector: ['node', 'value'],
      comparison_operator: 'contains',
      value: '',
    }],
  }],
  _targetBranches: [
    { id: 'case-1', name: 'Case 1' },
    { id: 'false', name: 'Else' },
  ],
} as unknown as IfElseNodeType)

describe('if-else use-config helpers', () => {
  it('filters vars and derives file attribute flags', () => {
    expect(filterAllVars()).toBe(true)
    expect(filterNumberVars({ type: VarType.number } as never)).toBe(true)
    expect(filterNumberVars({ type: VarType.string } as never)).toBe(false)
    expect(getVarsIsVarFileAttribute(createInputs().cases, selector => selector[1] === 'value')).toEqual({
      'condition-1': true,
    })
  })

  it('adds, removes and sorts cases while keeping target branches aligned', () => {
    const added = addCase(createInputs())
    expect(added.cases).toHaveLength(2)
    expect(added._targetBranches?.map(branch => branch.id)).toContain('false')

    const removed = removeCase(added, 'case-1')
    expect(removed.cases?.some(item => item.case_id === 'case-1')).toBe(false)

    const sorted = sortCases(createInputs(), [
      { id: 'display-2', case_id: 'case-2', logical_operator: LogicalOperator.or, conditions: [] },
      { id: 'display-1', case_id: 'case-1', logical_operator: LogicalOperator.and, conditions: [] },
    ] as unknown as Parameters<typeof sortCases>[1])
    expect(sorted.cases?.map(item => item.case_id)).toEqual(['case-2', 'case-1'])
    expect(sorted._targetBranches?.map(branch => branch.id)).toEqual(['case-2', 'case-1', 'false'])
  })

  it('adds, updates, toggles and removes conditions and sub-conditions', () => {
    const withCondition = addCondition({
      inputs: createInputs(),
      caseId: 'case-1',
      valueSelector: ['node', 'flag'],
      variable: { type: VarType.boolean } as never,
      isVarFileAttribute: false,
    })
    expect(withCondition.cases?.[0]?.conditions).toHaveLength(2)
    expect(withCondition.cases?.[0]?.conditions[1]).toEqual(expect.objectContaining({
      value: false,
      variable_selector: ['node', 'flag'],
    }))

    const updatedCondition = updateCondition(withCondition, 'case-1', 'condition-1', {
      id: 'condition-1',
      value: 'next',
      comparison_operator: '=',
    } as Parameters<typeof updateCondition>[3])
    expect(updatedCondition.cases?.[0]?.conditions[0]).toEqual(expect.objectContaining({
      value: 'next',
      comparison_operator: '=',
    }))

    const toggled = toggleConditionLogicalOperator(updatedCondition, 'case-1')
    expect(toggled.cases?.[0]?.logical_operator).toBe(LogicalOperator.or)

    const withSubCondition = addSubVariableCondition(toggled, 'case-1', 'condition-1', 'name')
    expect(withSubCondition.cases?.[0]?.conditions[0]?.sub_variable_condition?.conditions[0]).toEqual(expect.objectContaining({
      key: 'name',
      value: '',
    }))

    const firstSubConditionId = withSubCondition.cases?.[0]?.conditions[0]?.sub_variable_condition?.conditions[0]?.id
    expect(firstSubConditionId).toBeTruthy()
    const updatedSubCondition = updateSubVariableCondition(
      withSubCondition,
      'case-1',
      'condition-1',
      firstSubConditionId!,
      { key: 'size', comparison_operator: '>', value: '10' } as TestIfElseInputs['cases'][number]['conditions'][number],
    )
    expect(updatedSubCondition.cases?.[0]?.conditions[0]?.sub_variable_condition?.conditions[0]).toEqual(expect.objectContaining({
      key: 'size',
      value: '10',
    }))

    const toggledSub = toggleSubVariableConditionLogicalOperator(updatedSubCondition, 'case-1', 'condition-1')
    expect(toggledSub.cases?.[0]?.conditions[0]?.sub_variable_condition?.logical_operator).toBe(LogicalOperator.or)

    const removedSub = removeSubVariableCondition(
      toggledSub,
      'case-1',
      'condition-1',
      firstSubConditionId!,
    )
    expect(removedSub.cases?.[0]?.conditions[0]?.sub_variable_condition?.conditions).toEqual([])

    const removedCondition = removeCondition(removedSub, 'case-1', 'condition-1')
    expect(removedCondition.cases?.[0]?.conditions.some(item => item.id === 'condition-1')).toBe(false)
  })

  it('keeps inputs unchanged when guard branches short-circuit helper updates', () => {
    const unchangedWithoutCases = addCase({
      ...createInputs(),
      cases: undefined,
    } as unknown as IfElseNodeType)
    expect(unchangedWithoutCases.cases).toBeUndefined()

    const withoutTargetBranches = addCase({
      ...createInputs(),
      _targetBranches: undefined,
    })
    expect(withoutTargetBranches._targetBranches).toBeUndefined()

    const withoutElseBranch = addCase({
      ...createInputs(),
      _targetBranches: [{ id: 'case-1', name: 'Case 1' }],
    })
    expect(withoutElseBranch._targetBranches).toEqual([{ id: 'case-1', name: 'Case 1' }])

    const unchangedWhenConditionMissing = addSubVariableCondition(createInputs(), 'case-1', 'missing-condition', 'name')
    expect(unchangedWhenConditionMissing).toEqual(createInputs())

    const unchangedWhenSubConditionMissing = removeSubVariableCondition(createInputs(), 'case-1', 'condition-1', 'missing-sub')
    expect(unchangedWhenSubConditionMissing).toEqual(createInputs())

    const unchangedWhenCaseIsMissingForCondition = addCondition({
      inputs: createInputs(),
      caseId: 'missing-case',
      valueSelector: ['node', 'value'],
      variable: { type: VarType.string } as never,
      isVarFileAttribute: false,
    })
    expect(unchangedWhenCaseIsMissingForCondition).toEqual(createInputs())

    const unchangedWhenCaseMissing = toggleConditionLogicalOperator(createInputs(), 'missing-case')
    expect(unchangedWhenCaseMissing).toEqual(createInputs())

    const unchangedWhenSubVariableGroupMissing = toggleSubVariableConditionLogicalOperator(createInputs(), 'case-1', 'condition-1')
    expect(unchangedWhenSubVariableGroupMissing).toEqual(createInputs())
  })
})
