import type { IfElseNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  createNodeCrudModuleMock,
  createUuidModuleMock,
} from '../../__tests__/use-config-test-utils'
import { ComparisonOperator, LogicalOperator } from '../types'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockHandleEdgeDeleteByDeleteBranch = vi.hoisted(() => vi.fn())
const mockUpdateNodeInternals = vi.hoisted(() => vi.fn())
const mockGetIsVarFileAttribute = vi.hoisted(() => vi.fn())
const mockUuid = vi.hoisted(() => vi.fn(() => 'generated-id'))

vi.mock('uuid', () => ({
  ...createUuidModuleMock(mockUuid),
}))

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useUpdateNodeInternals: () => mockUpdateNodeInternals,
  }
})

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useEdgesInteractions: () => ({
    handleEdgeDeleteByDeleteBranch: (...args: unknown[]) => mockHandleEdgeDeleteByDeleteBranch(...args),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<IfElseNodeType>(mockSetInputs),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: (_id: string, { filterVar }: { filterVar: (value: { type: VarType }) => boolean }) => ({
    availableVars: filterVar({ type: VarType.number })
      ? [{ nodeId: 'node-1', title: 'Start', vars: [{ variable: 'score', type: VarType.number }] }]
      : [{ nodeId: 'node-1', title: 'Start', vars: [{ variable: 'answer', type: VarType.string }] }],
    availableNodesWithParent: [],
  }),
}))

vi.mock('../use-is-var-file-attribute', () => ({
  __esModule: true,
  default: () => ({
    getIsVarFileAttribute: (...args: unknown[]) => mockGetIsVarFileAttribute(...args),
  }),
}))

const createPayload = (overrides: Partial<IfElseNodeType> = {}): IfElseNodeType => ({
  title: 'If Else',
  desc: '',
  type: BlockEnum.IfElse,
  isInIteration: false,
  isInLoop: false,
  cases: [{
    case_id: 'case-1',
    logical_operator: LogicalOperator.and,
    conditions: [{
      id: 'condition-1',
      varType: VarType.string,
      variable_selector: ['node-1', 'answer'],
      comparison_operator: ComparisonOperator.contains,
      value: 'hello',
    }],
  }],
  _targetBranches: [
    { id: 'case-1', name: 'IF' },
    { id: 'false', name: 'ELSE' },
  ],
  ...overrides,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIsVarFileAttribute.mockReturnValue(false)
  })

  it('should expose derived vars and file-attribute flags', () => {
    const { result } = renderHook(() => useConfig('if-node', createPayload()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.filterVar()).toBe(true)
    expect(result.current.filterNumberVar({ type: VarType.number } as never)).toBe(true)
    expect(result.current.filterNumberVar({ type: VarType.string } as never)).toBe(false)
    expect(result.current.nodesOutputVars).toHaveLength(1)
    expect(result.current.nodesOutputNumberVars).toHaveLength(1)
    expect(result.current.varsIsVarFileAttribute).toEqual({ 'condition-1': false })
  })

  it('should manage cases and conditions', () => {
    const { result } = renderHook(() => useConfig('if-node', createPayload()))

    result.current.handleAddCase()
    result.current.handleRemoveCase('generated-id')
    result.current.handleAddCondition('case-1', ['node-1', 'score'], { type: VarType.number } as never)
    result.current.handleUpdateCondition('case-1', 'condition-1', {
      id: 'condition-1',
      varType: VarType.number,
      variable_selector: ['node-1', 'score'],
      comparison_operator: ComparisonOperator.largerThan,
      value: '3',
    })
    result.current.handleRemoveCondition('case-1', 'condition-1')
    result.current.handleToggleConditionLogicalOperator('case-1')
    result.current.handleSortCase([{
      id: 'sortable-1',
      case_id: 'case-1',
      logical_operator: LogicalOperator.or,
      conditions: [],
    }])

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          case_id: 'generated-id',
          logical_operator: LogicalOperator.and,
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: [
        expect.objectContaining({
          case_id: 'case-1',
          logical_operator: LogicalOperator.or,
        }),
      ],
      _targetBranches: [
        { id: 'case-1', name: 'IF' },
        { id: 'false', name: 'ELSE' },
      ],
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              id: 'generated-id',
              variable_selector: ['node-1', 'score'],
            }),
          ]),
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              id: 'condition-1',
              comparison_operator: ComparisonOperator.largerThan,
              value: '3',
            }),
          ]),
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          logical_operator: LogicalOperator.or,
        }),
      ]),
    }))
    expect(mockHandleEdgeDeleteByDeleteBranch).toHaveBeenCalledWith('if-node', 'generated-id')
    expect(mockUpdateNodeInternals).toHaveBeenCalledWith('if-node')
  })

  it('should manage sub-variable conditions', () => {
    const payload = createPayload({
      cases: [{
        case_id: 'case-1',
        logical_operator: LogicalOperator.and,
        conditions: [{
          id: 'condition-1',
          varType: VarType.file,
          variable_selector: ['node-1', 'files'],
          comparison_operator: ComparisonOperator.exists,
          value: '',
          sub_variable_condition: {
            case_id: 'sub-case-1',
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
      }],
    })
    const { result } = renderHook(() => useConfig('if-node', payload))

    result.current.handleAddSubVariableCondition('case-1', 'condition-1', 'name')
    result.current.handleUpdateSubVariableCondition('case-1', 'condition-1', 'sub-1', {
      id: 'sub-1',
      key: 'size',
      varType: VarType.string,
      comparison_operator: ComparisonOperator.is,
      value: '2',
    })
    result.current.handleRemoveSubVariableCondition('case-1', 'condition-1', 'sub-1')
    result.current.handleToggleSubVariableConditionLogicalOperator('case-1', 'condition-1')

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          conditions: expect.arrayContaining([
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
          ]),
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              sub_variable_condition: expect.objectContaining({
                conditions: expect.arrayContaining([
                  expect.objectContaining({
                    id: 'sub-1',
                    key: 'size',
                    value: '2',
                  }),
                ]),
              }),
            }),
          ]),
        }),
      ]),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      cases: expect.arrayContaining([
        expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              sub_variable_condition: expect.objectContaining({
                logical_operator: LogicalOperator.or,
              }),
            }),
          ]),
        }),
      ]),
    }))
  })
})
