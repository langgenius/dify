import type { ParameterExtractorNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { AppModeEnum, Resolution } from '@/types/app'
import useConfigVision from '../../../hooks/use-config-vision'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { ParamType, ReasoningModeType } from '../types'
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

const createData = (overrides: Partial<ParameterExtractorNodeType> = {}): ParameterExtractorNodeType => ({
  title: 'Parameter Extractor',
  desc: '',
  type: BlockEnum.ParameterExtractor,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as ParameterExtractorNodeType['model'],
  query: ['node-1', 'query'],
  reasoning_mode: ReasoningModeType.prompt,
  parameters: [{
    name: 'city',
    type: ParamType.string,
    description: 'City name',
    required: false,
  }],
  instruction: 'Extract {{#node-2.answer#}}',
  vision: {
    enabled: true,
    configs: {
      variable_selector: ['node-3', 'image'],
      detail: Resolution.high,
    },
  },
  ...overrides,
})

describe('parameter-extractor/use-single-run-form-params', () => {
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

  it('builds variable and vision single-run forms and returns dependent vars', () => {
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
      runInputData: { 'query': 'hello', '#context#': 'ctx', '#files#': ['file-1'] },
      runInputDataRef: { current: { 'query': 'hello', '#context#': 'ctx', '#files#': ['file-1'] } },
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
      '#context#': 'ctx',
      '#files#': ['file-1'],
    })
    expect(setRunInputData).toHaveBeenNthCalledWith(2, {
      'query': 'hello',
      '#context#': 'ctx',
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
