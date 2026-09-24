import type { AvailableModelListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { MutableRefObject } from 'react'
import type { LLMNodeType } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { Type } from '../../types'
import useLLMStructuredOutputConfig from '../use-llm-structured-output-config'

const mockModelListQuery = vi.hoisted(() =>
  vi.fn<() => { data: AvailableModelListResponse['data'] }>(),
)

const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  },
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  ...overrides,
})

describe('use-llm-structured-output-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects supported models and updates structured output state', () => {
    mockModelListQuery.mockReturnValue({
      data: [
        {
          provider: 'openai',
          tenant_id: 'test-workspace',
          label: { en_US: 'OpenAI' },
          status: 'active',
          models: [
            {
              model: 'gpt-4o',
              label: { en_US: 'gpt-4o' },
              model_type: 'llm',
              fetch_from: 'predefined-model',
              status: 'active',
              model_properties: {},
              features: [ModelFeatureEnum.StructuredOutput],
            },
          ],
        },
      ],
    })

    const inputRef = {
      current: createPayload(),
    } as MutableRefObject<LLMNodeType>
    const handleSetInputs = vi.fn((nextInputs: LLMNodeType) => {
      inputRef.current = nextInputs
    })
    const deleteNodeInspectorVars = vi.fn()

    const { result } = renderHook(() =>
      useLLMStructuredOutputConfig({
        id: 'llm-node',
        model: inputRef.current.model,
        inputRef,
        setInputs: handleSetInputs,
        deleteNodeInspectorVars,
      }),
    )

    expect(result.current.isModelSupportStructuredOutput).toBe(true)
    expect(result.current.structuredOutputCollapsed).toBe(true)

    act(() => {
      result.current.handleStructureOutputEnableChange(true)
    })

    expect(handleSetInputs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        structured_output_enabled: true,
      }),
    )
    expect(result.current.structuredOutputCollapsed).toBe(false)
    expect(deleteNodeInspectorVars).toHaveBeenCalledWith('llm-node')

    act(() => {
      result.current.handleStructureOutputChange({
        schema: {
          type: Type.object,
          properties: {
            answer: {
              type: Type.string,
            },
          },
          additionalProperties: false,
        },
      })
      result.current.handleReasoningFormatChange('separated')
      result.current.handleStructureOutputEnableChange(false)
    })

    expect(handleSetInputs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        structured_output: {
          schema: {
            type: Type.object,
            properties: {
              answer: {
                type: Type.string,
              },
            },
            additionalProperties: false,
          },
        },
      }),
    )
    expect(handleSetInputs).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        reasoning_format: 'separated',
      }),
    )
    expect(handleSetInputs).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        structured_output_enabled: false,
      }),
    )
  })

  it('returns undefined support when the model is missing from the list', () => {
    mockModelListQuery.mockReturnValue({
      data: [
        {
          provider: 'anthropic',
          tenant_id: 'test-workspace',
          label: { en_US: 'Anthropic' },
          status: 'active',
          models: [
            {
              model: 'claude',
              label: { en_US: 'claude' },
              model_type: 'llm',
              fetch_from: 'predefined-model',
              status: 'active',
              model_properties: {},
              features: [],
            },
          ],
        },
      ],
    })

    const { result } = renderHook(() =>
      useLLMStructuredOutputConfig({
        id: 'llm-node',
        model: createPayload().model,
        inputRef: { current: createPayload() } as MutableRefObject<LLMNodeType>,
        setInputs: vi.fn(),
        deleteNodeInspectorVars: vi.fn(),
      }),
    )

    expect(result.current.isModelSupportStructuredOutput).toBeUndefined()
  })
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: mockModelListQuery }
})
