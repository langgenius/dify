import type { LoopNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, ErrorHandleMode, ValueType, VarType } from '@/app/components/workflow/types'
import {
  createNodeCrudModuleMock,
  createUuidModuleMock,
} from '../../__tests__/use-config-test-utils'
import { ComparisonOperator, LogicalOperator } from '../types'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockGetLoopNodeChildren = vi.hoisted(() => vi.fn())
const mockGetIsVarFileAttribute = vi.hoisted(() => vi.fn())
const mockUuid = vi.hoisted(() => vi.fn(() => 'generated-id'))

vi.mock('uuid', () => ({
  ...createUuidModuleMock(mockUuid),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { conversationVariables: unknown[], dataSourceList: unknown[] }) => unknown) => selector({
    conversationVariables: [],
    dataSourceList: [],
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useIsChatMode: () => false,
  useWorkflow: () => ({
    getLoopNodeChildren: (...args: unknown[]) => mockGetLoopNodeChildren(...args),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<LoopNodeType>(mockSetInputs),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  toNodeOutputVars: () => [{ nodeId: 'child-node', title: 'Child', vars: [] }],
}))

vi.mock('../use-is-var-file-attribute', () => ({
  __esModule: true,
  default: () => ({
    getIsVarFileAttribute: (...args: unknown[]) => mockGetIsVarFileAttribute(...args),
  }),
}))

const createPayload = (overrides: Partial<LoopNodeType> = {}): LoopNodeType => ({
  title: 'Loop',
  desc: '',
  type: BlockEnum.Loop,
  start_node_id: 'start-node',
  loop_id: 'loop-node',
  logical_operator: LogicalOperator.and,
  break_conditions: [{
    id: 'condition-1',
    varType: VarType.string,
    variable_selector: ['node-1', 'answer'],
    comparison_operator: ComparisonOperator.contains,
    value: 'hello',
  }],
  loop_count: 3,
  error_handle_mode: ErrorHandleMode.ContinueOnError,
  loop_variables: [{
    id: 'loop-var-1',
    label: 'item',
    var_type: VarType.string,
    value_type: ValueType.constant,
    value: 'value',
  }],
  ...overrides,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLoopNodeChildren.mockReturnValue([])
    mockGetIsVarFileAttribute.mockReturnValue(false)
  })

  it('should expose derived outputs and input variable filtering', () => {
    const { result } = renderHook(() => useConfig('loop-node', createPayload()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.childrenNodeVars).toEqual([{ nodeId: 'child-node', title: 'Child', vars: [] }])
    expect(result.current.loopChildrenNodes).toHaveLength(1)
    expect(result.current.filterInputVar({ type: VarType.arrayNumber } as never)).toBe(true)
    expect(result.current.filterInputVar({ type: VarType.string } as never)).toBe(false)
  })

  it('should update error mode, break conditions and logical operators', () => {
    const { result } = renderHook(() => useConfig('loop-node', createPayload()))

    result.current.changeErrorResponseMode({ value: ErrorHandleMode.Terminated })
    result.current.handleAddCondition(['node-1', 'score'], { type: VarType.number } as never)
    result.current.handleUpdateCondition('condition-1', {
      id: 'condition-1',
      varType: VarType.number,
      variable_selector: ['node-1', 'score'],
      comparison_operator: ComparisonOperator.largerThan,
      value: '3',
    })
    result.current.handleRemoveCondition('condition-1')
    result.current.handleToggleConditionLogicalOperator()

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      error_handle_mode: ErrorHandleMode.Terminated,
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      break_conditions: expect.arrayContaining([
        expect.objectContaining({
          id: 'generated-id',
          variable_selector: ['node-1', 'score'],
          varType: VarType.number,
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      break_conditions: expect.arrayContaining([
        expect.objectContaining({
          varType: VarType.number,
          comparison_operator: ComparisonOperator.largerThan,
          value: '3',
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      logical_operator: LogicalOperator.or,
    }))
  })

  it('should manage sub-variable conditions and loop variables', () => {
    const payload = createPayload({
      break_conditions: [{
        id: 'condition-1',
        varType: VarType.file,
        variable_selector: ['node-1', 'files'],
        comparison_operator: ComparisonOperator.contains,
        value: '',
        sub_variable_condition: {
          logical_operator: LogicalOperator.and,
          conditions: [{
            id: 'sub-1',
            key: 'name',
            varType: VarType.string,
            comparison_operator: ComparisonOperator.contains,
            value: '',
          }],
        },
      }],
    })
    const { result } = renderHook(() => useConfig('loop-node', payload))

    result.current.handleAddSubVariableCondition('condition-1', 'name')
    result.current.handleUpdateSubVariableCondition('condition-1', 'sub-1', {
      id: 'sub-1',
      key: 'size',
      varType: VarType.string,
      comparison_operator: ComparisonOperator.contains,
      value: '2',
    })
    result.current.handleRemoveSubVariableCondition('condition-1', 'sub-1')
    result.current.handleToggleSubVariableConditionLogicalOperator('condition-1')
    result.current.handleUpdateLoopCount(5)
    result.current.handleAddLoopVariable()
    result.current.handleRemoveLoopVariable('loop-var-1')
    result.current.handleUpdateLoopVariable('loop-var-1', { label: 'updated' })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      break_conditions: [
        expect.objectContaining({
          sub_variable_condition: expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({
                id: 'generated-id',
                key: 'name',
              }),
            ]),
          }),
        }),
      ],
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      break_conditions: [
        expect.objectContaining({
          sub_variable_condition: expect.objectContaining({
            logical_operator: LogicalOperator.or,
          }),
        }),
      ],
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      loop_count: 5,
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      loop_variables: expect.arrayContaining([
        expect.objectContaining({
          id: 'generated-id',
          value_type: ValueType.constant,
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      loop_variables: [
        expect.objectContaining({
          id: 'generated-id',
          value_type: ValueType.constant,
        }),
      ],
    }))
  })
})
