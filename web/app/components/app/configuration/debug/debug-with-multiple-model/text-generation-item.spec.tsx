import type { ModelAndParameter } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import { TransferMethod } from '@/app/components/base/chat/types'
import { DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { ModelModeType } from '@/types/app'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../types'
import TextGenerationItem from './text-generation-item'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseProviderContext = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseTextGeneration = vi.fn()
const mockUseEventEmitterContextContext = vi.fn()
const mockPromptVariablesToUserInputsForm = vi.fn()

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: unknown) => unknown) => mockUseFeatures(selector),
}))

vi.mock('@/app/components/base/text-generation/hooks', () => ({
  useTextGeneration: () => mockUseTextGeneration(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

vi.mock('@/utils/model-config', () => ({
  promptVariablesToUserInputsForm: (vars: unknown) => mockPromptVariablesToUserInputsForm(vars),
}))

let capturedTextGenerationProps: Record<string, unknown> | null = null
vi.mock('@/app/components/app/text-generate/item', () => ({
  default: (props: Record<string, unknown>) => {
    capturedTextGenerationProps = props
    return <div data-testid="text-generation-component">TextGeneration</div>
  },
}))

let modelIdCounter = 0

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: `model-${++modelIdCounter}`,
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const createDefaultModelConfig = () => ({
  provider: 'openai',
  model_id: 'gpt-4',
  mode: ModelModeType.completion,
  configs: {
    prompt_template: 'Hello {{name}}',
    prompt_variables: [
      { key: 'name', name: 'Name', type: 'string' as const, is_context_var: false },
      { key: 'context', name: 'Context', type: 'string' as const, is_context_var: true },
    ],
  },
  chat_prompt_config: DEFAULT_CHAT_PROMPT_CONFIG,
  completion_prompt_config: DEFAULT_COMPLETION_PROMPT_CONFIG,
  opening_statement: '',
  more_like_this: null,
  suggested_questions: [],
  suggested_questions_after_answer: null,
  speech_to_text: null,
  text_to_speech: null,
  file_upload: null,
  retriever_resource: null,
  sensitive_word_avoidance: null,
  annotation_reply: null,
  external_data_tools: [],
  dataSets: [],
  agentConfig: DEFAULT_AGENT_SETTING,
  system_parameters: {
    audio_file_size_limit: 0,
    file_size_limit: 0,
    image_file_size_limit: 0,
    video_file_size_limit: 0,
    workflow_file_upload_limit: 0,
  },
})

const createDefaultFeatures = () => ({
  moreLikeThis: { enabled: true },
  moderation: { enabled: false },
  text2speech: { enabled: true },
  file: { enabled: true },
})

const createTextGenerationModelList = (models: Array<{
  provider: string
  model: string
  mode?: string
}> = []) => {
  const providerMap = new Map<string, { model: string, model_properties: { mode: string } }[]>()

  for (const m of models) {
    if (!providerMap.has(m.provider)) {
      providerMap.set(m.provider, [])
    }
    providerMap.get(m.provider)!.push({
      model: m.model,
      model_properties: { mode: m.mode ?? 'completion' },
    })
  }

  return Array.from(providerMap.entries()).map(([provider, modelsList]) => ({
    provider,
    models: modelsList,
  }))
}

describe('TextGenerationItem', () => {
  let subscriptionCallback: ((v: { type: string, payload?: { message: string, files?: unknown[] } }) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    modelIdCounter = 0
    capturedTextGenerationProps = null
    subscriptionCallback = null

    mockUseDebugConfigurationContext.mockReturnValue({
      isAdvancedMode: false,
      modelConfig: createDefaultModelConfig(),
      appId: 'test-app-id',
      inputs: { name: 'World' },
      promptMode: 'simple',
      speechToTextConfig: { enabled: true },
      introduction: 'Welcome',
      suggestedQuestionsAfterAnswerConfig: { enabled: false },
      citationConfig: { enabled: false },
      externalDataToolsConfig: [],
      chatPromptConfig: DEFAULT_CHAT_PROMPT_CONFIG,
      completionPromptConfig: DEFAULT_COMPLETION_PROMPT_CONFIG,
      dataSets: [{ id: 'ds-1', name: 'Dataset 1' }],
      datasetConfigs: { retrieval_model: 'single' },
    })

    mockUseProviderContext.mockReturnValue({
      textGenerationModelList: createTextGenerationModelList([
        { provider: 'openai', model: 'gpt-3.5-turbo', mode: 'completion' },
        { provider: 'openai', model: 'gpt-4', mode: 'completion' },
      ]),
    })

    const features = createDefaultFeatures()
    mockUseFeatures.mockImplementation((selector: (state: { features: ReturnType<typeof createDefaultFeatures> }) => unknown) => selector({ features }))

    mockUseTextGeneration.mockReturnValue({
      completion: 'Generated text',
      handleSend: vi.fn(),
      isResponding: false,
      messageId: 'msg-1',
    })

    mockUseEventEmitterContextContext.mockReturnValue({
      eventEmitter: {
        // eslint-disable-next-line react/no-unnecessary-use-prefix -- mocking real API
        useSubscription: (callback: (v: { type: string, payload?: { message: string, files?: unknown[] } }) => void) => {
          subscriptionCallback = callback
        },
      },
    })

    mockPromptVariablesToUserInputsForm.mockReturnValue([
      { key: 'name', label: 'Name', variable: 'name' },
    ])
  })

  describe('rendering', () => {
    it('should render TextGeneration component', () => {
      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      expect(screen.getByTestId('text-generation-component')).toBeInTheDocument()
    })

    it('should pass correct props to TextGeneration component', () => {
      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      expect(capturedTextGenerationProps!.content).toBe('Generated text')
      expect(capturedTextGenerationProps!.isLoading).toBe(false)
      expect(capturedTextGenerationProps!.isResponding).toBe(false)
      expect(capturedTextGenerationProps!.messageId).toBe('msg-1')
      expect(capturedTextGenerationProps!.isError).toBe(false)
      expect(capturedTextGenerationProps!.inSidePanel).toBe(true)
      expect(capturedTextGenerationProps!.siteInfo).toBeNull()
    })

    it('should show loading state when no completion and is responding', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend: vi.fn(),
        isResponding: true,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      expect(capturedTextGenerationProps!.isLoading).toBe(true)
    })

    it('should not show loading state when has completion', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: 'Some text',
        handleSend: vi.fn(),
        isResponding: true,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      expect(capturedTextGenerationProps!.isLoading).toBe(false)
    })
  })

  describe('config building', () => {
    it('should build config with correct pre_prompt in simple mode', () => {
      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      // The config is built internally, we verify via the handleSend call
      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      const handleSend = mockUseTextGeneration().handleSend
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            pre_prompt: 'Hello {{name}}',
          }),
        }),
      )
    })

    it('should use empty pre_prompt in advanced mode', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockUseDebugConfigurationContext(),
        isAdvancedMode: true,
        modelConfig: createDefaultModelConfig(),
        appId: 'test-app-id',
        inputs: {},
        promptMode: 'advanced',
        speechToTextConfig: { enabled: true },
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: { enabled: false },
        citationConfig: { enabled: false },
        externalDataToolsConfig: [],
        chatPromptConfig: DEFAULT_CHAT_PROMPT_CONFIG,
        completionPromptConfig: DEFAULT_COMPLETION_PROMPT_CONFIG,
        dataSets: [],
        datasetConfigs: { retrieval_model: 'single' },
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      const handleSend = mockUseTextGeneration().handleSend
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            pre_prompt: '',
          }),
        }),
      )
    })

    it('should find context variable from prompt_variables', () => {
      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      const handleSend = mockUseTextGeneration().handleSend
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            dataset_query_variable: 'context',
          }),
        }),
      )
    })

    it('should use empty string for dataset_query_variable when no context var exists', () => {
      const modelConfigWithoutContextVar = {
        ...createDefaultModelConfig(),
        configs: {
          prompt_template: 'Hello {{name}}',
          prompt_variables: [
            { key: 'name', name: 'Name', type: 'string' as const, is_context_var: false },
          ],
        },
      }
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: modelConfigWithoutContextVar,
        appId: 'test-app-id',
        inputs: { name: 'World' },
        promptMode: 'simple',
        speechToTextConfig: { enabled: true },
        introduction: 'Welcome',
        suggestedQuestionsAfterAnswerConfig: { enabled: false },
        citationConfig: { enabled: false },
        externalDataToolsConfig: [],
        chatPromptConfig: DEFAULT_CHAT_PROMPT_CONFIG,
        completionPromptConfig: DEFAULT_COMPLETION_PROMPT_CONFIG,
        dataSets: [],
        datasetConfigs: { retrieval_model: 'single' },
      })

      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            dataset_query_variable: '',
          }),
        }),
      )
    })
  })

  describe('datasets transformation', () => {
    it('should transform dataSets to postDatasets format', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        ...mockUseDebugConfigurationContext(),
        isAdvancedMode: false,
        modelConfig: createDefaultModelConfig(),
        appId: 'test-app-id',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: { enabled: true },
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: { enabled: false },
        citationConfig: { enabled: false },
        externalDataToolsConfig: [],
        chatPromptConfig: DEFAULT_CHAT_PROMPT_CONFIG,
        completionPromptConfig: DEFAULT_COMPLETION_PROMPT_CONFIG,
        dataSets: [
          { id: 'ds-1', name: 'Dataset 1' },
          { id: 'ds-2', name: 'Dataset 2' },
        ],
        datasetConfigs: { retrieval_model: 'single' },
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      const handleSend = mockUseTextGeneration().handleSend
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            dataset_configs: expect.objectContaining({
              datasets: {
                datasets: [
                  { dataset: { enabled: true, id: 'ds-1' } },
                  { dataset: { enabled: true, id: 'ds-2' } },
                ],
              },
            }),
          }),
        }),
      )
    })
  })

  describe('event subscription', () => {
    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL event', async () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test message', files: [] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalledWith(
          'apps/test-app-id/completion-messages',
          expect.any(Object),
        )
      })
    })

    it('should ignore non-matching events', async () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: 'SOME_OTHER_EVENT',
        payload: { message: 'test' },
      })

      expect(handleSend).not.toHaveBeenCalled()
    })
  })

  describe('doSend', () => {
    it('should build config data with model info', async () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter({
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        parameters: { temperature: 0.8 },
      })

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      await waitFor(() => {
        expect(handleSend).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            model_config: expect.objectContaining({
              model: {
                provider: 'openai',
                name: 'gpt-3.5-turbo',
                mode: 'completion',
                completion_params: { temperature: 0.8 },
              },
            }),
          }),
        )
      })
    })

    it('should process local files by clearing url', async () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      const files = [
        { id: 'file-1', transfer_method: TransferMethod.local_file, url: 'http://example.com/file1' },
        { id: 'file-2', transfer_method: TransferMethod.remote_url, url: 'http://example.com/file2' },
      ]

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files },
      })

      await waitFor(() => {
        const callArgs = handleSend.mock.calls[0][1]
        expect(callArgs.files[0].url).toBe('')
        expect(callArgs.files[1].url).toBe('http://example.com/file2')
      })
    })

    it('should not include files when file upload is disabled', async () => {
      const features = { ...createDefaultFeatures(), file: { enabled: false } }
      mockUseFeatures.mockImplementation((selector: (state: { features: typeof features }) => unknown) => selector({ features }))

      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      const files = [{ id: 'file-1', transfer_method: TransferMethod.remote_url }]

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files },
      })

      await waitFor(() => {
        const callArgs = handleSend.mock.calls[0][1]
        expect(callArgs.files).toBeUndefined()
      })
    })

    it('should not include files when no files provided', async () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: 'text',
        handleSend,
        isResponding: false,
        messageId: 'msg-1',
      })

      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      await waitFor(() => {
        const callArgs = handleSend.mock.calls[0][1]
        expect(callArgs.files).toBeUndefined()
      })
    })
  })

  describe('features integration', () => {
    it('should include features in config', () => {
      const modelAndParameter = createModelAndParameter()

      render(<TextGenerationItem modelAndParameter={modelAndParameter} />)

      subscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'test', files: [] },
      })

      const handleSend = mockUseTextGeneration().handleSend
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            more_like_this: { enabled: true },
            sensitive_word_avoidance: { enabled: false },
            text_to_speech: { enabled: true },
            file_upload: { enabled: true },
          }),
        }),
      )
    })
  })
})
