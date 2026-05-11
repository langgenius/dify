import type { VariableAssignerNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const createData = (overrides: Partial<VariableAssignerNodeType> = {}): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'rootVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'sharedVar'], ['source-node', 'uniqueVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [['source-node', 'sharedVar']],
      },
    ],
  },
  ...overrides,
})

describe('variable-assigner/use-single-run-form-params', () => {
  it('deduplicates grouped variable inputs and marks them optional for single run', () => {
    const setRunInputData = vi.fn()
    const varSelectorsToVarInputs = vi.fn<() => InputVar[]>(() => [
      {
        label: 'Shared',
        variable: 'sharedVar',
        type: InputVarType.textInput,
        required: true,
      },
      {
        label: 'Unique',
        variable: 'uniqueVar',
        type: InputVarType.number,
        required: true,
      },
      {
        label: 'Shared duplicate',
        variable: 'sharedVar',
        type: InputVarType.textInput,
        required: true,
      },
    ])

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'assigner-node',
      payload: createData(),
      runInputData: { sharedVar: 'hello' },
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: () => [],
      varSelectorsToVarInputs,
    }))

    expect(varSelectorsToVarInputs).toHaveBeenCalledWith([
      ['source-node', 'sharedVar'],
      ['source-node', 'uniqueVar'],
      ['source-node', 'sharedVar'],
    ])
    expect(result.current.forms[0]!.inputs).toEqual([
      {
        label: 'Shared',
        variable: 'sharedVar',
        type: InputVarType.textInput,
        required: false,
      },
      {
        label: 'Unique',
        variable: 'uniqueVar',
        type: InputVarType.number,
        required: false,
      },
    ])

    result.current.forms[0]!.onChange({ sharedVar: 'updated' })

    expect(setRunInputData).toHaveBeenCalledWith({ sharedVar: 'updated' })
    expect(result.current.getDependentVars()).toEqual([
      [['source-node', 'sharedVar'], ['source-node', 'uniqueVar']],
      [['source-node', 'sharedVar']],
    ])
  })

  it('returns root variables directly when grouping is disabled', () => {
    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'assigner-node',
      payload: createData({
        advanced_settings: {
          group_enabled: false,
          groups: [],
        },
        variables: [['source-node', 'rootVar']],
      }),
      runInputData: {},
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData: vi.fn(),
      toVarInputs: () => [],
      varSelectorsToVarInputs: () => [],
    }))

    expect(result.current.getDependentVars()).toEqual([
      [['source-node', 'rootVar']],
    ])
  })
})
