import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { renderWorkflowFlowHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { AssignerNodeInputType, WriteMode } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

const createOperation = (
  overrides: Partial<AssignerNodeOperation> = {},
): AssignerNodeOperation => ({
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
    createOperation({
      operation: WriteMode.set,
      input_type: AssignerNodeInputType.constant,
      value: 'fixed',
    }),
    createOperation({
      operation: WriteMode.increment,
      input_type: AssignerNodeInputType.constant,
      value: 2,
    }),
  ],
  ...overrides,
})

describe('assigner/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes only variable-driven dependencies in the single-run form', () => {
    const setRunInputData = vi.fn()
    const varInputs: InputVar[] = [
      {
        label: 'Result',
        variable: 'result',
        type: InputVarType.textInput,
        required: true,
      },
    ]
    const varSelectorsToVarInputs = vi.fn(() => varInputs)

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'assigner-node',
        payload: createData(),
        runInputData: { result: 'hello' },
        runInputDataRef: { current: {} },
        getInputVars: () => [],
        setRunInputData,
        toVarInputs: () => [],
        varSelectorsToVarInputs,
      }),
    )

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
