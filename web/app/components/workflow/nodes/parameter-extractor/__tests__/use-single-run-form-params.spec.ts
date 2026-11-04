import type { ParameterExtractorNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { useState } from 'react'
import { renderWorkflowCanvasHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'
import { createSingleRunGraphOptions } from '../../__tests__/single-run-graph-options'
import { ParamType, ReasoningModeType } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

const createData = (
  overrides: Partial<ParameterExtractorNodeType> = {},
): ParameterExtractorNodeType => ({
  title: 'Parameter Extractor',
  desc: '',
  type: BlockEnum.ParameterExtractor,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat' as const,
    completion_params: {},
  },
  query: ['node-1', 'query'],
  reasoning_mode: ReasoningModeType.prompt,
  parameters: [
    {
      name: 'city',
      type: ParamType.string,
      description: 'City name',
      required: false,
    },
  ],
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
  it('builds variable and vision single-run forms and returns dependent vars', () => {
    const getInputVars = (): InputVar[] => [
      {
        label: 'Answer',
        variable: '#node-2.answer#',
        type: InputVarType.textInput,
        required: true,
      },
    ]

    const payload = createData()
    const { result } = renderHook(() => {
      const [runInputData, setRunInputData] = useState<Record<string, unknown>>({
        query: 'hello',
        '#context#': 'ctx',
        '#files#': ['file-1'],
      })
      return useSingleRunFormParams({
        id: 'current-node',
        payload,
        runInputData,
        runInputDataRef: { current: runInputData },
        getInputVars,
        setRunInputData,
        toVarInputs: () => [],
      })
    }, createSingleRunGraphOptions(payload))

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[0]!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: 'query',
          type: InputVarType.paragraph,
        }),
        expect.objectContaining({
          variable: '#node-2.answer#',
        }),
      ]),
    )
    expect(result.current.forms[1]!.inputs).toEqual([
      {
        label: 'image',
        variable: '#files#',
        type: InputVarType.singleFile,
        required: false,
      },
    ])

    act(() => result.current.forms[0]!.onChange({ query: 'updated' }))
    expect(result.current.forms[0]!.values).toMatchObject({ query: 'updated' })
    expect(result.current.forms[1]!.values).toEqual({ '#files#': ['file-1'] })
    act(() => result.current.forms[1]!.onChange({ '#files#': ['file-2'] }))
    expect(result.current.forms[0]!.values).toMatchObject({ query: 'updated' })
    expect(result.current.forms[1]!.values).toEqual({ '#files#': ['file-2'] })
    expect(result.current.getDependentVars()).toEqual([
      ['node-1', 'query'],
      ['node-2', 'answer'],
      ['node-3', 'image'],
    ])
    expect(result.current.getDependentVar('query')).toEqual(['node-1', 'query'])
    expect(result.current.getDependentVar('#files#')).toEqual(['node-3', 'image'])
    expect(result.current.getDependentVar('unknown')).toBe(false)
  })

  it('omits vision inputs and dependencies when vision is disabled', () => {
    const payload = createData({ instruction: '', vision: { enabled: false } })
    const { result } = renderHook(
      () =>
        useSingleRunFormParams({
          id: 'current-node',
          payload,
          runInputData: {},
          runInputDataRef: { current: {} },
          getInputVars: () => [],
          setRunInputData: vi.fn(),
          toVarInputs: () => [],
        }),
      createSingleRunGraphOptions(payload),
    )
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs.map((input) => input.variable)).toEqual(['query'])
    expect(result.current.getDependentVars()).toEqual([['node-1', 'query']])
  })
})
