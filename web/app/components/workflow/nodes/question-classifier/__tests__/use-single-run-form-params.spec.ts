import type { QuestionClassifierNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'
import useConfigVision from '../../../hooks/use-config-vision'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('../../../hooks/use-config-vision', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfigVision = vi.mocked(useConfigVision)
const mockUseAvailableVarList = vi.mocked(useAvailableVarList)
const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createData = (overrides: Partial<QuestionClassifierNodeType> = {}): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  } as QuestionClassifierNodeType['model'],
  classes: [{ id: 'topic-1', name: 'Billing questions' }],
  query_variable_selector: ['node-1', 'query'],
  instruction: 'Route by {{#node-2.answer#}}',
  vision: {
    enabled: true,
    configs: {
      variable_selector: ['node-3', 'image'],
      detail: Resolution.high,
    },
  },
  ...overrides,
})

describe('question-classifier/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: vi.fn(),
    } as unknown as ReturnType<typeof useNodeCrud>)
    mockUseConfigVision.mockReturnValue({
      isVisionModel: true,
    } as ReturnType<typeof useConfigVision>)
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{
        nodeId: 'node-3',
        title: 'Vision Source',
        vars: [{
          variable: 'image',
          type: VarType.file,
        }],
      }],
    } as unknown as ReturnType<typeof useAvailableVarList>)
  })

  it('builds variable and vision forms and exposes dependent variables', () => {
    const setRunInputData = vi.fn()
    const getInputVars = vi.fn<() => InputVar[]>(() => [{
      label: 'Answer',
      variable: '#node-2.answer#',
      type: InputVarType.textInput,
      required: true,
    }])

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'node-1',
      payload: createData(),
      runInputData: { 'query': 'hello', '#files#': ['file-1'] },
      runInputDataRef: { current: { 'query': 'hello', '#files#': ['file-1'] } },
      getInputVars,
      setRunInputData,
      toVarInputs: () => [],
    }))

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[0]!.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        variable: 'query',
        type: InputVarType.paragraph,
      }),
      expect.objectContaining({
        variable: '#node-2.answer#',
      }),
    ]))
    expect(result.current.forms[1]!.inputs).toEqual([{
      label: 'image',
      variable: '#files#',
      type: InputVarType.singleFile,
      required: false,
    }])

    result.current.forms[0]!.onChange({ query: 'updated' })
    result.current.forms[1]!.onChange({ '#files#': ['file-2'] })

    expect(setRunInputData).toHaveBeenNthCalledWith(1, {
      'query': 'updated',
      '#files#': ['file-1'],
    })
    expect(setRunInputData).toHaveBeenNthCalledWith(2, {
      'query': 'hello',
      '#files#': ['file-2'],
    })
    const availableVarOptions = mockUseAvailableVarList.mock.calls[0]![1] as { filterVar: (payload: { type: VarType }) => boolean }

    expect(availableVarOptions.filterVar({ type: VarType.file })).toBe(true)
    expect(availableVarOptions.filterVar({ type: VarType.string })).toBe(false)
    expect(result.current.getDependentVars()).toEqual([
      ['node-1', 'query'],
      ['node-2', 'answer'],
      ['node-3', 'image'],
    ])
    expect(result.current.getDependentVar('query')).toEqual(['node-1', 'query'])
    expect(result.current.getDependentVar('#files#')).toEqual(['node-3', 'image'])
    expect(result.current.getDependentVar('unknown')).toBe(false)
  })

  it('omits the vision form when the selected model does not support vision', () => {
    mockUseConfigVision.mockReturnValue({
      isVisionModel: false,
    } as ReturnType<typeof useConfigVision>)

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'node-1',
      payload: createData(),
      runInputData: {},
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData: vi.fn(),
      toVarInputs: () => [],
    }))

    expect(result.current.forms).toHaveLength(1)
  })

  it('skips malformed prompt variables when collecting dependent vars', () => {
    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'node-1',
      payload: createData(),
      runInputData: {},
      runInputDataRef: { current: {} },
      getInputVars: () => [{
        label: 'Broken',
        variable: undefined as unknown as string,
        type: InputVarType.textInput,
        required: false,
      }],
      setRunInputData: vi.fn(),
      toVarInputs: () => [],
    }))

    expect(result.current.getDependentVars()).toEqual([
      ['node-1', 'query'],
      ['node-3', 'image'],
    ])
  })
})
