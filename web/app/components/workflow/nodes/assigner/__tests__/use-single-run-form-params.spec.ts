import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { AssignerNodeInputType, WriteMode } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('../../_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createOperation = (overrides: Partial<AssignerNodeOperation> = {}): AssignerNodeOperation => ({
  variable_selector: ['node-1', 'target'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-2', 'result'],
  ...overrides,
})

const createData = (overrides: Partial<AssignerNodeType> = {}): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  version: '2',
  items: [
    createOperation(),
    createOperation({ operation: WriteMode.append, value: ['node-3', 'items'] }),
    createOperation({ operation: WriteMode.clear, value: ['node-4', 'unused'] }),
    createOperation({ operation: WriteMode.set, input_type: AssignerNodeInputType.constant, value: 'fixed' }),
    createOperation({ operation: WriteMode.increment, input_type: AssignerNodeInputType.constant, value: 2 }),
  ],
  ...overrides,
})

describe('assigner/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: vi.fn(),
    } as unknown as ReturnType<typeof useNodeCrud>)
  })

  it('exposes only variable-driven dependencies in the single-run form', () => {
    const setRunInputData = vi.fn()
    const varInputs: InputVar[] = [{
      label: 'Result',
      variable: 'result',
      type: InputVarType.textInput,
      required: true,
    }]
    const varSelectorsToVarInputs = vi.fn(() => varInputs)

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'assigner-node',
      payload: createData(),
      runInputData: { result: 'hello' },
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: () => [],
      varSelectorsToVarInputs,
    }))

    expect(varSelectorsToVarInputs).toHaveBeenCalledWith([
      ['node-2', 'result'],
      ['node-3', 'items'],
    ])
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs).toEqual(varInputs)
    expect(result.current.forms[0]!.values).toEqual({ result: 'hello' })

    result.current.forms[0]!.onChange({ result: 'updated' })

    expect(setRunInputData).toHaveBeenCalledWith({ result: 'updated' })
    expect(result.current.getDependentVars()).toEqual([
      ['node-2', 'result'],
      ['node-3', 'items'],
    ])
  })
})
