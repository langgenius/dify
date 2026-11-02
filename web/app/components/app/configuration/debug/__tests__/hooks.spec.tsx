import { act, renderHook } from '@testing-library/react'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import {
  createDatasetConfigsFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { AgentStrategy } from '@/types/app'
import {
  useConfigFromDebugContext,
  useDebugWithSingleOrMultipleModel,
  useFormattingChangedDispatcher,
  useFormattingChangedSubscription,
} from '../hooks'

const mockUseDebugConfigurationContext = vi.fn()

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

describe('configuration debug hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('should persist multiple-model debug settings in local storage', () => {
    const { result, unmount } = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))

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
    unmount()
    const restored = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))
    expect(restored.result.current.debugWithMultipleModel).toBe(true)
    expect(restored.result.current.multipleModelConfigs).toEqual([
      {
        id: 'model-1',
        model: 'gpt-4o',
        provider: 'langgenius/openai/openai',
        parameters: { temperature: 0.7 },
      },
    ])
    const otherApp = renderHook(() => useDebugWithSingleOrMultipleModel('app-2'))
    expect(otherApp.result.current.debugWithMultipleModel).toBe(false)
    expect(otherApp.result.current.multipleModelConfigs).toEqual([])
  })

  it.each(['{', 'null'])('should fall back to default settings for stored value %s', (value) => {
    localStorage.setItem('app-debug-with-single-or-multiple-models', value)

    const { result } = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))

    expect(result.current.debugWithMultipleModel).toBe(false)
    expect(result.current.multipleModelConfigs).toEqual([])
  })

  it('should derive chat config data from the debug context', () => {
    mockUseDebugConfigurationContext.mockReturnValue({
      isAdvancedMode: false,
      modelConfig: createModelConfigFixture({
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
      }),
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
      datasetConfigs: createDatasetConfigsFixture({ retrieval_model: 'multiple' }),
      visionConfig: { transfer_methods: ['local_file'], number_limits: 2 },
      annotationConfig: { enabled: false },
      textToSpeechConfig: { enabled: false, voice: '', language: '' },
      isFunctionCall: true,
    })

    const { result } = renderHook(() => useConfigFromDebugContext())

    expect(result.current).toEqual(
      expect.objectContaining({
        appId: 'app-1',
        dataset_query_variable: '',
        opening_statement: 'hello',
        pre_prompt: 'hello {{name}}',
        suggested_questions: ['how are you?'],
      }),
    )
    expect(result.current.agent_mode?.strategy).toBe(AgentStrategy.functionCall)
    expect(result.current.dataset_configs?.datasets?.datasets).toEqual([
      { dataset: { enabled: true, id: 'dataset-1' } },
    ])
  })

  it.each([
    { hasAnswer: true, formattingChanged: false, calls: 1 },
    { hasAnswer: false, formattingChanged: false, calls: 0 },
    { hasAnswer: true, formattingChanged: true, calls: 0 },
  ])(
    'dispatches formatting changes only for existing answers requiring refresh: %j',
    ({ hasAnswer, formattingChanged, calls }) => {
      const setFormattingChanged = vi.fn()
      mockUseDebugConfigurationContext.mockReturnValue({ formattingChanged, setFormattingChanged })
      const { result } = renderHook(
        () => {
          useFormattingChangedSubscription([
            { id: 'message-1', content: 'Hello', isAnswer: hasAnswer },
          ])
          return useFormattingChangedDispatcher()
        },
        { wrapper: EventEmitterContextProvider },
      )
      act(() => result.current())
      expect(setFormattingChanged).toHaveBeenCalledTimes(calls)
      if (calls) expect(setFormattingChanged).toHaveBeenCalledWith(true)
    },
  )
})
