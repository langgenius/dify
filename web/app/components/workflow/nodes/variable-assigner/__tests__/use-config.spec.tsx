import type { VariableAssignerNodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  createNodeCrudModuleMock,
  createUuidModuleMock,
} from '../../__tests__/use-config-test-utils'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockDeleteNodeInspectorVars = vi.hoisted(() => vi.fn())
const mockRenameInspectVarName = vi.hoisted(() => vi.fn())
const mockHandleOutVarRenameChange = vi.hoisted(() => vi.fn())
const mockIsVarUsedInNodes = vi.hoisted(() => vi.fn())
const mockRemoveUsedVarInNodes = vi.hoisted(() => vi.fn())
const mockGetAvailableVars = vi.hoisted(() => vi.fn())
const mockUuid = vi.hoisted(() => vi.fn(() => 'generated-group-id'))

vi.mock('uuid', () => ({
  ...createUuidModuleMock(mockUuid),
}))

vi.mock('ahooks', () => ({
  useBoolean: (initialValue: boolean) => {
    let current = initialValue
    return [
      current,
      {
        setTrue: () => {
          current = true
        },
        setFalse: () => {
          current = false
        },
      },
    ] as const
  },
  useDebounceFn: (fn: (...args: unknown[]) => void) => ({
    run: fn,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
  useWorkflow: () => ({
    handleOutVarRenameChange: (...args: unknown[]) => mockHandleOutVarRenameChange(...args),
    isVarUsedInNodes: (...args: unknown[]) => mockIsVarUsedInNodes(...args),
    removeUsedVarInNodes: (...args: unknown[]) => mockRemoveUsedVarInNodes(...args),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  ...createNodeCrudModuleMock<VariableAssignerNodeType>(mockSetInputs),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  __esModule: true,
  default: () => ({
    deleteNodeInspectorVars: (...args: unknown[]) => mockDeleteNodeInspectorVars(...args),
    renameInspectVarName: (...args: unknown[]) => mockRenameInspectVarName(...args),
  }),
}))

vi.mock('../hooks', () => ({
  useGetAvailableVars: () => mockGetAvailableVars,
}))

const createPayload = (overrides: Partial<VariableAssignerNodeType> = {}): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'initialVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'initialVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
  ...overrides,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAvailableVars.mockReturnValue([])
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  it('should expose read-only state, group mode and typed variable filters', () => {
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.isEnableGroup).toBe(true)
    expect(result.current.filterVar(VarType.string)({ type: VarType.any } as never)).toBe(true)
    expect(result.current.filterVar(VarType.number)({ type: VarType.string } as never)).toBe(false)
    expect(result.current.getAvailableVars).toBe(mockGetAvailableVars)
  })

  it('should update root and grouped variable payloads', () => {
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    result.current.handleListOrTypeChange({
      output_type: VarType.number,
      variables: [['source-node', 'changed']],
    })
    result.current.handleListOrTypeChangeInGroup('group-1')({
      output_type: VarType.boolean,
      variables: [['source-node', 'groupVar']],
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      output_type: VarType.number,
      variables: [['source-node', 'changed']],
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({
        groups: [
          expect.objectContaining({
            groupId: 'group-1',
            output_type: VarType.boolean,
            variables: [['source-node', 'groupVar']],
          }),
          expect.anything(),
        ],
      }),
    }))
  })

  it('should add and remove groups and toggle group mode', () => {
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    result.current.handleAddGroup()
    result.current.handleGroupRemoved('group-2')()
    result.current.handleGroupEnabledChange(false)

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({
        groups: expect.arrayContaining([
          expect.objectContaining({
            groupId: 'generated-group-id',
            group_name: 'Group3',
          }),
        ]),
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({
        groups: [
          expect.objectContaining({ groupId: 'group-1' }),
        ],
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({
        group_enabled: false,
      }),
      output_type: VarType.string,
      variables: [['source-node', 'initialVar']],
    }))
    expect(mockDeleteNodeInspectorVars).toHaveBeenCalledWith('assigner-node')
    expect(mockHandleOutVarRenameChange).toHaveBeenCalledWith(
      'assigner-node',
      ['assigner-node', 'Group1', 'output'],
      ['assigner-node', 'output'],
    )
  })

  it('should rename groups and remove used vars after confirmation', () => {
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    result.current.handleVarGroupNameChange('group-1')('Renamed')
    result.current.onRemoveVarConfirm()

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({
        groups: [
          expect.objectContaining({
            groupId: 'group-1',
            group_name: 'Renamed',
          }),
          expect.anything(),
        ],
      }),
    }))
    expect(mockHandleOutVarRenameChange).toHaveBeenCalledWith(
      'assigner-node',
      ['assigner-node', 'Group1', 'output'],
      ['assigner-node', 'Renamed', 'output'],
    )
    expect(mockRenameInspectVarName).toHaveBeenCalledWith('assigner-node', 'Group1', 'Renamed')
  })

  it('should confirm removing a used group before deleting it', () => {
    mockIsVarUsedInNodes.mockImplementation(selector => selector[1] === 'Group2')
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    act(() => {
      result.current.handleGroupRemoved('group-2')()
    })
    act(() => {
      result.current.onRemoveVarConfirm()
    })

    expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['assigner-node', 'Group2', 'output'])
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({
        groups: [expect.objectContaining({ groupId: 'group-1' })],
      }),
    }))
  })

  it('should enable empty groups and confirm disabling when downstream vars are used', () => {
    const { result: enableResult } = renderHook(() => useConfig('assigner-node', createPayload({
      advanced_settings: {
        group_enabled: false,
        groups: [],
      },
    })))

    enableResult.current.handleGroupEnabledChange(true)

    expect(mockHandleOutVarRenameChange).toHaveBeenCalledWith(
      'assigner-node',
      ['assigner-node', 'output'],
      ['assigner-node', 'Group1', 'output'],
    )

    mockIsVarUsedInNodes.mockImplementation(selector => selector[1] === 'Group2')
    const { result } = renderHook(() => useConfig('assigner-node', createPayload()))

    act(() => {
      result.current.handleGroupEnabledChange(false)
    })
    act(() => {
      result.current.onRemoveVarConfirm()
    })

    expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['assigner-node', 'Group2', 'output'])
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      advanced_settings: expect.objectContaining({ group_enabled: false }),
    }))
  })
})
