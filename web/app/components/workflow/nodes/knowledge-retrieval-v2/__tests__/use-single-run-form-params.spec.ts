import type { KnowledgeRetrievalV2NodeType } from '../types'
import { renderHook } from '@testing-library/react'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import {
  ComparisonOperator,
  LogicalOperator,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
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
      availableNodes: [],
      availableNodesWithParent: [],
      availableVars: [
        {
          nodeId: 'start',
          title: 'Start',
          vars: [{ variable: 'images', type: VarType.arrayFile }],
        },
      ],
    })
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

  it('exposes metadata filter variables as single-run inputs and dependencies', () => {
    const setRunInputData = vi.fn()
    const current = { query: 'policy', '#start.department#': 'sales' }
    const getInputVars = vi.fn((texts: string[]) =>
      texts.includes('{{#start.department#}}')
        ? [
            {
              label: 'department',
              variable: '#start.department#',
              type: InputVarType.textInput,
              required: true,
            },
          ]
        : [],
    )
    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'retrieval-1',
        payload: createData({
          query_attachment_selector: [],
          metadata_filtering_conditions: {
            logical_operator: LogicalOperator.and,
            conditions: [
              {
                id: 'condition-1',
                name: 'department',
                comparison_operator: ComparisonOperator.is,
                value: '{{#start.department#}}',
              },
            ],
          },
        }),
        runInputData: current,
        runInputDataRef: { current },
        getInputVars,
        setRunInputData,
        toVarInputs: () => [],
      }),
    )

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[1]!.inputs).toEqual([
      expect.objectContaining({ variable: '#start.department#' }),
    ])
    expect(result.current.forms[1]!.values).toEqual({ '#start.department#': 'sales' })
    expect(result.current.getDependentVars()).toContainEqual(['start', 'department'])

    result.current.forms[1]!.onChange({ '#start.department#': 'support' })
    expect(setRunInputData).toHaveBeenCalledWith({
      '#start.department#': 'support',
      query: 'policy',
      queryAttachment: undefined,
    })
  })
})
