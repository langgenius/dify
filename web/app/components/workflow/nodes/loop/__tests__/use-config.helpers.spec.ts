import type { LoopNodeType } from '../types'
import { BlockEnum, ErrorHandleMode, ValueType, VarType } from '@/app/components/workflow/types'
import { createUuidModuleMock } from '../../__tests__/use-config-test-utils'
import { ComparisonOperator, LogicalOperator } from '../types'
import {
  addBreakCondition,
  addLoopVariable,
  addSubVariableCondition,
  canUseAsLoopInput,
  removeBreakCondition,
  removeLoopVariable,
  removeSubVariableCondition,
  toggleConditionOperator,
  toggleSubVariableConditionOperator,
  updateBreakCondition,
  updateErrorHandleMode,
  updateLoopCount,
  updateLoopVariable,
  updateSubVariableCondition,
} from '../use-config.helpers'

const mockUuid = vi.hoisted(() => vi.fn())

vi.mock('uuid', () => createUuidModuleMock(() => mockUuid()))

const createInputs = (overrides: Partial<LoopNodeType> = {}): LoopNodeType => ({
  title: 'Loop',
  desc: '',
  type: BlockEnum.Loop,
  start_node_id: 'start-node',
  loop_count: 3,
  error_handle_mode: ErrorHandleMode.Terminated,
  logical_operator: LogicalOperator.and,
  break_conditions: [],
  loop_variables: [],
  ...overrides,
})

describe('loop use-config helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('canUseAsLoopInput', () => {
    it.each([
      VarType.array,
      VarType.arrayString,
      VarType.arrayNumber,
      VarType.arrayObject,
      VarType.arrayFile,
    ])('should accept %s loop inputs', (type) => {
      expect(canUseAsLoopInput({ type } as never)).toBe(true)
    })

    it('should reject non-array loop inputs', () => {
      expect(canUseAsLoopInput({ type: VarType.string } as never)).toBe(false)
    })
  })

  it('should update error handling, loop count and logical operators immutably', () => {
    const inputs = createInputs()

    const withMode = updateErrorHandleMode(inputs, ErrorHandleMode.ContinueOnError)
    const withCount = updateLoopCount(withMode, 6)
    const toggled = toggleConditionOperator(withCount)
    const toggledBack = toggleConditionOperator(toggled)

    expect(withMode.error_handle_mode).toBe(ErrorHandleMode.ContinueOnError)
    expect(withCount.loop_count).toBe(6)
    expect(toggled.logical_operator).toBe(LogicalOperator.or)
    expect(toggledBack.logical_operator).toBe(LogicalOperator.and)
    expect(inputs.error_handle_mode).toBe(ErrorHandleMode.Terminated)
    expect(inputs.loop_count).toBe(3)
  })

  it('should add, update and remove break conditions for regular and file attributes', () => {
    mockUuid
      .mockReturnValueOnce('condition-1')
      .mockReturnValueOnce('condition-2')

    const withBooleanCondition = addBreakCondition({
      inputs: createInputs({ break_conditions: undefined }),
      valueSelector: ['tool-node', 'enabled'],
      variable: { type: VarType.boolean },
      isVarFileAttribute: false,
    })
    const withFileCondition = addBreakCondition({
      inputs: withBooleanCondition,
      valueSelector: ['tool-node', 'file', 'transfer_method'],
      variable: { type: VarType.file },
      isVarFileAttribute: true,
    })
    const updated = updateBreakCondition(withFileCondition, 'condition-2', {
      id: 'condition-2',
      varType: VarType.file,
      key: 'transfer_method',
      variable_selector: ['tool-node', 'file', 'transfer_method'],
      comparison_operator: ComparisonOperator.notIn,
      value: [VarType.file],
    })
    const removed = removeBreakCondition(updated, 'condition-1')

    expect(withBooleanCondition.break_conditions).toEqual([
      expect.objectContaining({
        id: 'condition-1',
        varType: VarType.boolean,
        comparison_operator: ComparisonOperator.is,
        value: 'false',
      }),
    ])
    expect(withFileCondition.break_conditions?.[1]).toEqual(expect.objectContaining({
      id: 'condition-2',
      varType: VarType.file,
      comparison_operator: ComparisonOperator.in,
      value: '',
    }))
    expect(updated.break_conditions?.[1]).toEqual(expect.objectContaining({
      comparison_operator: ComparisonOperator.notIn,
      value: [VarType.file],
    }))
    expect(removed.break_conditions).toEqual([
      expect.objectContaining({ id: 'condition-2' }),
    ])
  })

  it('should manage nested sub-variable conditions and ignore missing targets', () => {
    mockUuid
      .mockReturnValueOnce('sub-condition-1')
      .mockReturnValueOnce('sub-condition-2')

    const inputs = createInputs({
      break_conditions: [{
        id: 'condition-1',
        varType: VarType.file,
        key: 'name',
        variable_selector: ['tool-node', 'file'],
        comparison_operator: ComparisonOperator.contains,
        value: '',
      }],
    })

    const untouched = addSubVariableCondition(inputs, 'missing-condition')
    const withKeyedSubCondition = addSubVariableCondition(inputs, 'condition-1', 'transfer_method')
    const withDefaultKeySubCondition = addSubVariableCondition(withKeyedSubCondition, 'condition-1')
    const updated = updateSubVariableCondition(withDefaultKeySubCondition, 'condition-1', 'sub-condition-1', {
      id: 'sub-condition-1',
      key: 'transfer_method',
      varType: VarType.string,
      comparison_operator: ComparisonOperator.notIn,
      value: ['remote_url'],
    })
    const toggled = toggleSubVariableConditionOperator(updated, 'condition-1')
    const removed = removeSubVariableCondition(toggled, 'condition-1', 'sub-condition-1')
    const unchangedAfterMissingRemove = removeSubVariableCondition(removed, 'missing-condition', 'sub-condition-2')

    expect(untouched).toEqual(inputs)
    expect(withKeyedSubCondition.break_conditions?.[0].sub_variable_condition).toEqual({
      logical_operator: LogicalOperator.and,
      conditions: [{
        id: 'sub-condition-1',
        key: 'transfer_method',
        varType: VarType.string,
        comparison_operator: ComparisonOperator.in,
        value: '',
      }],
    })
    expect(withDefaultKeySubCondition.break_conditions?.[0].sub_variable_condition?.conditions[1]).toEqual({
      id: 'sub-condition-2',
      key: '',
      varType: VarType.string,
      comparison_operator: undefined,
      value: '',
    })
    expect(updated.break_conditions?.[0].sub_variable_condition?.conditions[0]).toEqual(expect.objectContaining({
      comparison_operator: ComparisonOperator.notIn,
      value: ['remote_url'],
    }))
    expect(toggled.break_conditions?.[0].sub_variable_condition?.logical_operator).toBe(LogicalOperator.or)
    expect(removed.break_conditions?.[0].sub_variable_condition?.conditions).toEqual([
      expect.objectContaining({ id: 'sub-condition-2' }),
    ])
    expect(unchangedAfterMissingRemove).toEqual(removed)
  })

  it('should add, update and remove loop variables without mutating the source inputs', () => {
    mockUuid.mockReturnValueOnce('loop-variable-1')

    const inputs = createInputs({ loop_variables: undefined })
    const added = addLoopVariable(inputs)
    const updated = updateLoopVariable(added, 'loop-variable-1', {
      label: 'Loop Value',
      value_type: ValueType.variable,
      value: ['tool-node', 'result'],
    })
    const unchanged = updateLoopVariable(updated, 'missing-loop-variable', { label: 'ignored' })
    const removed = removeLoopVariable(unchanged, 'loop-variable-1')

    expect(added.loop_variables).toEqual([{
      id: 'loop-variable-1',
      label: '',
      var_type: VarType.string,
      value_type: ValueType.constant,
      value: '',
    }])
    expect(updated.loop_variables).toEqual([{
      id: 'loop-variable-1',
      label: 'Loop Value',
      var_type: VarType.string,
      value_type: ValueType.variable,
      value: ['tool-node', 'result'],
    }])
    expect(unchanged).toEqual(updated)
    expect(removed.loop_variables).toEqual([])
    expect(inputs.loop_variables).toBeUndefined()
  })
})
