import type { CodeNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { CodeLanguage } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('../../_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.javascript,
  code: 'function main({ amount }) { return { result: amount } }',
  variables: [{
    variable: 'amount',
    value_selector: ['start', 'amount'],
    value_type: VarType.number,
  }],
  outputs: {
    result: {
      type: VarType.number,
      children: null,
    },
  },
  ...overrides,
})

describe('code/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: vi.fn(),
    } as unknown as ReturnType<typeof useNodeCrud>)
  })

  it('builds a single form, updates run input values, and exposes dependent vars', () => {
    const setRunInputData = vi.fn()

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'code-node',
      payload: createData(),
      runInputData: { amount: 1 },
      runInputDataRef: { current: { amount: 1 } },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: variables => variables.map(variable => ({
        type: InputVarType.number,
        label: variable.variable,
        variable: variable.variable,
        required: false,
      })),
    }))

    expect(result.current.forms).toEqual([{
      inputs: [{
        type: InputVarType.number,
        label: 'amount',
        variable: 'amount',
        required: false,
      }],
      values: { amount: 1 },
      onChange: expect.any(Function),
    }])

    result.current.forms[0]?.onChange({ amount: 3 })

    expect(setRunInputData).toHaveBeenCalledWith({ amount: 3 })
    expect(result.current.getDependentVars()).toEqual([['start', 'amount']])
    expect(result.current.getDependentVar('amount')).toEqual(['start', 'amount'])
    expect(result.current.getDependentVar('missing')).toBeUndefined()
  })
})
