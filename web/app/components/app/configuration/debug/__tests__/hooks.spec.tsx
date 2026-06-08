/* eslint-disable ts/no-explicit-any */
import { act, renderHook } from '@testing-library/react'
import { AgentStrategy } from '@/types/app'
import {
  useConfigFromDebugContext,
  useDebugWithSingleOrMultipleModel,
  useFormattingChangedDispatcher,
  useFormattingChangedSubscription,
} from '../hooks'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseEventEmitterContextContext = vi.fn()

let subscriptionCallback: ((value: { type: string }) => void) | null = null

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

describe('configuration debug hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    subscriptionCallback = null

    mockUseEventEmitterContextContext.mockReturnValue({
      eventEmitter: {
        emit: vi.fn(),
        useSubscription: (callback: (value: { type: string }) => void) => {
          subscriptionCallback = callback
        },
      },
    })
  })

  it('should persist multiple-model debug settings in local storage', () => {
    const { result } = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))

    act(() => {
      result.current.handleMultipleModelConfigsChange(true, [
        {
          id: 'model-1',
          model: 'gpt-4o',
          provider: 'langgenius/openai/openai',
          parameters: { temperature: 0.7 },
        },
      ])
    })

    expect(result.current.debugWithMultipleModel).toBe(true)
    expect(result.current.multipleModelConfigs).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('app-debug-with-single-or-multiple-models') || '{}')).toEqual({
      'app-1': {
        multiple: true,
        configs: [
          {
            id: 'model-1',
            model: 'gpt-4o',
            provider: 'langgenius/openai/openai',
            parameters: { temperature: 0.7 },
          },
        ],
      },
    })
  })

  it('should derive chat config data from the debug context', () => {
    mockUseDebugConfigurationContext.mockReturnValue({
      isAdvancedMode: false,
      modelConfig: {
        agentConfig: {
          enabled: true,
          max_iteration: 3,
          strategy: AgentStrategy.react,
          tools: [],
        },
        configs: {
          prompt_template: 'hello {{name}}',
          prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
        },
        more_like_this: { enabled: true },
        system_parameters: {
          audio_file_size_limit: 1,
          file_size_limit: 1,
          image_file_size_limit: 1,
          video_file_size_limit: 1,
          workflow_file_upload_limit: 1,
        },
      },
      appId: 'app-1',
      promptMode: 'simple',
      speechToTextConfig: { enabled: false },
      introduction: 'hello',
      suggestedQuestions: ['how are you?'],
      suggestedQuestionsAfterAnswerConfig: { enabled: false },
      citationConfig: { enabled: true },
      moderationConfig: { enabled: false },
      chatPromptConfig: { prompt: [] },
      completionPromptConfig: { prompt: { text: 'completion' } },
      dataSets: [{ id: 'dataset-1' }],
      datasetConfigs: { retrieval_model: 'multiple' },
      visionConfig: { transfer_methods: ['local_file'], number_limits: 2 },
      annotationConfig: { enabled: false },
      textToSpeechConfig: { enabled: false, voice: '', language: '' },
      isFunctionCall: true,
    })

    const { result } = renderHook(() => useConfigFromDebugContext())

    expect(result.current).toEqual(expect.objectContaining({
      appId: 'app-1',
      dataset_query_variable: '',
      opening_statement: 'hello',
      pre_prompt: 'hello {{name}}',
      suggested_questions: ['how are you?'],
    }))
    expect(result.current.agent_mode?.strategy).toBe(AgentStrategy.functionCall)
    expect(result.current.dataset_configs?.datasets?.datasets).toEqual([
      { dataset: { enabled: true, id: 'dataset-1' } },
    ])
  })

  it('should dispatch and subscribe to formatting change events', () => {
    const emit = vi.fn()
    const setFormattingChanged = vi.fn()
    mockUseEventEmitterContextContext.mockReturnValue({
      eventEmitter: {
        emit,
        useSubscription: (callback: (value: { type: string }) => void) => {
          subscriptionCallback = callback
        },
      },
    })
    mockUseDebugConfigurationContext.mockReturnValue({
      formattingChanged: false,
      setFormattingChanged,
    })

    const { result } = renderHook(() => useFormattingChangedDispatcher())
    renderHook(() => useFormattingChangedSubscription([{ isAnswer: true }] as any))

    act(() => {
      result.current()
      subscriptionCallback?.({ type: 'ORCHESTRATE_CHANGED' })
    })

    expect(emit).toHaveBeenCalledWith({ type: 'ORCHESTRATE_CHANGED' })
    expect(setFormattingChanged).toHaveBeenCalledWith(true)
  })
})
