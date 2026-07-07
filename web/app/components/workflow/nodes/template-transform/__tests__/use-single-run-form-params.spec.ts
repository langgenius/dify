import type { TemplateTransformNodeType } from '../types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('../../_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createVariable = (overrides: Partial<Variable> = {}): Variable => ({
  variable: 'input_text',
  value_selector: ['node-1', 'input_text'],
  value_type: VarType.string,
  ...overrides,
})

const createData = (overrides: Partial<TemplateTransformNodeType> = {}): TemplateTransformNodeType => ({
  title: 'Template Transform',
  desc: '',
  type: BlockEnum.TemplateTransform,
  variables: [createVariable()],
  template: '{{ input_text }}',
  ...overrides,
})

describe('template-transform/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: vi.fn(),
    } as unknown as ReturnType<typeof useNodeCrud>)
  })

  it('exposes variable inputs and forwards single-run changes', () => {
    const setRunInputData = vi.fn()
    const varInputs: InputVar[] = [{
      label: 'Input Text',
      variable: 'input_text',
      type: InputVarType.textInput,
      required: true,
    }]

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'template-node',
      payload: createData(),
      runInputData: { input_text: 'hello' },
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: () => varInputs,
    }))

    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs).toEqual(varInputs)
    expect(result.current.forms[0]!.values).toEqual({ input_text: 'hello' })

    result.current.forms[0]!.onChange({ input_text: 'updated' })

    expect(setRunInputData).toHaveBeenCalledWith({ input_text: 'updated' })
    expect(result.current.getDependentVars()).toEqual([['node-1', 'input_text']])
    expect(result.current.getDependentVar('input_text')).toEqual(['node-1', 'input_text'])
  })
})
