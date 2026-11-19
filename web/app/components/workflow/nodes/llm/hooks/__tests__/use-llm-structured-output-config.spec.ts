import type { AvailableModelListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { RefObject } from 'react'
import type { LLMNodeType } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { Type } from '../../types'
import useLLMStructuredOutputConfig from '../use-llm-structured-output-config'

const mockModelListQuery = vi.hoisted(() => vi.fn<() => Promise<AvailableModelListResponse>>())

const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat' as const,
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

  it('detects supported models and updates structured output state', async () => {
    mockModelListQuery.mockResolvedValue({
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
    } as RefObject<LLMNodeType>
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

    await waitFor(() => expect(result.current.isModelSupportStructuredOutput).toBe(true))
    expect(result.current.structuredOutputCollapsed).toBe(true)

    act(() => {
      result.current.handleStructureOutputEnableChange(true)
    })

    expect(inputRef.current.structured_output_enabled).toBe(true)
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

    expect(inputRef.current).toMatchObject({
      structured_output: {
        schema: {
          type: Type.object,
          properties: { answer: { type: Type.string } },
          additionalProperties: false,
        },
      },
      reasoning_format: 'separated',
      structured_output_enabled: false,
    })
  })

  it('returns undefined support when the model is missing from the list', async () => {
    mockModelListQuery.mockResolvedValue({
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

    const { result, queryClient } = renderHook(() =>
      useLLMStructuredOutputConfig({
        id: 'llm-node',
        model: createPayload().model,
        inputRef: { current: createPayload() } as RefObject<LLMNodeType>,
        setInputs: vi.fn(),
        deleteNodeInspectorVars: vi.fn(),
      }),
    )

    const queryKey = consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: 'llm' } },
    })
    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe('success'))
    expect(result.current.isModelSupportStructuredOutput).toBeUndefined()
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': () => mockModelListQuery(),
    }),
  }
})
