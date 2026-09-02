import type { KnowledgeRetrievalV2NodeType } from '../types'
import { renderHook } from '@testing-library/react'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: vi.fn(),
}))

const mockUseAvailableVarList = vi.mocked(useAvailableVarList)

const createData = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: BlockEnum.KnowledgeRetrievalV2,
  control_space_ids: ['space-1', 'space-2'],
  query_variable_selector: ['start', 'query'],
  query_attachment_selector: ['start', 'images'],
  top_n: 10,
  ...overrides,
})

describe('knowledge-retrieval-v2/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [
        {
          nodeId: 'start',
          title: 'Start',
          vars: [{ variable: 'images', type: VarType.arrayFile }],
        },
      ],
    } as unknown as ReturnType<typeof useAvailableVarList>)
  })

  it('builds an image form whenever an attachment selector is configured', () => {
    const setRunInputData = vi.fn()
    const current = { query: 'find this diagram', queryAttachment: ['file-1'] }
    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'retrieval-1',
        payload: createData(),
        runInputData: current,
        runInputDataRef: { current },
        getInputVars: () => [],
        setRunInputData,
        toVarInputs: () => [],
      }),
    )

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[1]!.inputs).toEqual([
      expect.objectContaining({
        variable: 'queryAttachment',
        type: InputVarType.multiFiles,
        required: false,
      }),
    ])

    result.current.forms[1]!.onChange({ queryAttachment: ['file-2'] })
    expect(setRunInputData).toHaveBeenCalledWith({
      query: 'find this diagram',
      queryAttachment: ['file-2'],
    })
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'query'],
      ['start', 'images'],
    ])
    expect(result.current.getDependentVar('queryAttachment')).toEqual(['start', 'images'])
  })

  it('omits the image form when the node has no attachment selector', () => {
    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'retrieval-1',
        payload: createData({ query_attachment_selector: [] }),
        runInputData: {},
        runInputDataRef: { current: {} },
        getInputVars: () => [],
        setRunInputData: vi.fn(),
        toVarInputs: () => [],
      }),
    )

    expect(result.current.forms).toHaveLength(1)
  })
})
