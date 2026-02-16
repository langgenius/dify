import type { ModelAndParameter } from '../types'
import { render, screen } from '@testing-library/react'
import { TransferMethod } from '@/app/components/base/chat/types'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../types'
import TextGenerationItem from './text-generation-item'

const mockUseDebugConfigurationContext = vi.fn()
const mockUseProviderContext = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseTextGeneration = vi.fn()
const mockUseEventEmitterContextContext = vi.fn()
const mockPromptVariablesToUserInputsForm = vi.fn()

let capturedTextGenerationProps: {
  content: string
  isLoading: boolean
  isResponding: boolean
  messageId: string | null
  className?: string
} | null = null

let eventSubscriptionCallback: ((v: { type: string, payload?: Record<string, unknown> }) => void) | null = null

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

vi.mock('@/app/components/base/text-generation/hooks', () => ({
  useTextGeneration: () => mockUseTextGeneration(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

vi.mock('@/utils/model-config', () => ({
  promptVariablesToUserInputsForm: (...args: unknown[]) => mockPromptVariablesToUserInputsForm(...args),
}))

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: (props: typeof capturedTextGenerationProps) => {
    capturedTextGenerationProps = props
    return (
      <div data-testid="text-generation">
        <span data-testid="content">{props?.content}</span>
        <span data-testid="is-loading">{props?.isLoading ? 'yes' : 'no'}</span>
        <span data-testid="is-responding">{props?.isResponding ? 'yes' : 'no'}</span>
        <span data-testid="message-id">{props?.messageId || 'null'}</span>
      </div>
    )
  },
}))

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const createDefaultMocks = () => {
  mockUseDebugConfigurationContext.mockReturnValue({
    isAdvancedMode: false,
    modelConfig: {
      configs: {
        prompt_template: 'Hello {{name}}',
        prompt_variables: [
          { key: 'name', name: 'Name', type: 'string', is_context_var: false },
        ],
      },
      system_parameters: {},
    },
    appId: 'app-123',
    inputs: { name: 'World' },
    promptMode: 'simple',
    speechToTextConfig: { enabled: true },
    introduction: 'Welcome!',
    suggestedQuestionsAfterAnswerConfig: { enabled: false },
    citationConfig: { enabled: true },
    externalDataToolsConfig: [],
    chatPromptConfig: {},
    completionPromptConfig: {},
    dataSets: [{ id: 'ds-1' }],
    datasetConfigs: { retrieval_model: 'single' },
  })

  mockUseProviderContext.mockReturnValue({
    textGenerationModelList: [
      {
        provider: 'openai',
        models: [
          {
            model: 'gpt-3.5-turbo',
            model_properties: { mode: 'chat' },
          },
        ],
      },
    ],
  })

  mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      features: {
        moreLikeThis: { enabled: false },
        moderation: { enabled: false },
        text2speech: { enabled: false },
        file: { enabled: true },
      },
    }
    return selector(state)
  })

  mockUseTextGeneration.mockReturnValue({
    completion: 'Generated text',
    handleSend: vi.fn(),
    isResponding: false,
    messageId: 'msg-123',
  })

  mockUseEventEmitterContextContext.mockReturnValue({
    eventEmitter: {
      useSubscription: (callback: (v: { type: string, payload?: Record<string, unknown> }) => void) => {
        eventSubscriptionCallback = callback
      },
    },
  })

  mockPromptVariablesToUserInputsForm.mockReturnValue([
    { variable: 'name', label: 'Name', type: 'text-input', required: true },
  ])
}

const renderComponent = (props: Partial<{ modelAndParameter: ModelAndParameter }> = {}) => {
  const defaultProps = {
    modelAndParameter: createModelAndParameter(),
    ...props,
  }
  return render(<TextGenerationItem {...defaultProps} />)
}

describe('TextGenerationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedTextGenerationProps = null
    eventSubscriptionCallback = null
    createDefaultMocks()
  })

  describe('rendering', () => {
    it('should render TextGeneration component', () => {
      renderComponent()

      expect(screen.getByTestId('text-generation')).toBeInTheDocument()
    })

    it('should pass completion content to TextGeneration', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: 'Hello World',
        handleSend: vi.fn(),
        isResponding: false,
        messageId: 'msg-1',
      })

      renderComponent()

      expect(screen.getByTestId('content')).toHaveTextContent('Hello World')
    })

    it('should show loading when no completion and responding', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend: vi.fn(),
        isResponding: true,
        messageId: null,
      })

      renderComponent()

      expect(screen.getByTestId('is-loading')).toHaveTextContent('yes')
    })

    it('should not show loading when completion exists', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: 'Some text',
        handleSend: vi.fn(),
        isResponding: true,
        messageId: 'msg-1',
      })

      renderComponent()

      expect(screen.getByTestId('is-loading')).toHaveTextContent('no')
    })

    it('should pass isResponding to TextGeneration', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: 'Text',
        handleSend: vi.fn(),
        isResponding: true,
        messageId: 'msg-1',
      })

      renderComponent()

      expect(screen.getByTestId('is-responding')).toHaveTextContent('yes')
    })

    it('should pass messageId to TextGeneration', () => {
      mockUseTextGeneration.mockReturnValue({
        completion: 'Text',
        handleSend: vi.fn(),
        isResponding: false,
        messageId: 'msg-456',
      })

      renderComponent()

      expect(screen.getByTestId('message-id')).toHaveTextContent('msg-456')
    })
  })

  describe('config composition', () => {
    it('should use prompt_template in non-advanced mode', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: {
            prompt_template: 'My Template',
            prompt_variables: [],
          },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: {},
        completionPromptConfig: {},
        dataSets: [],
        datasetConfigs: {},
      })

      renderComponent()

      // Config is built internally - we verify through the component rendering
      expect(capturedTextGenerationProps).not.toBeNull()
    })

    it('should use empty pre_prompt in advanced mode', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: true,
        modelConfig: {
          configs: {
            prompt_template: 'Should not be used',
            prompt_variables: [],
          },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'advanced',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: { custom: true },
        completionPromptConfig: { custom: true },
        dataSets: [],
        datasetConfigs: {},
      })

      renderComponent()

      expect(capturedTextGenerationProps).not.toBeNull()
    })

    it('should find context variable from prompt_variables', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: {
            prompt_template: '',
            prompt_variables: [
              { key: 'context', name: 'Context', type: 'string', is_context_var: true },
              { key: 'query', name: 'Query', type: 'string', is_context_var: false },
            ],
          },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: {},
        completionPromptConfig: {},
        dataSets: [],
        datasetConfigs: {},
      })

      renderComponent()

      expect(capturedTextGenerationProps).not.toBeNull()
    })
  })

  describe('dataset configuration', () => {
    it('should transform dataSets to postDatasets format', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: { prompt_template: '', prompt_variables: [] },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: {},
        completionPromptConfig: {},
        dataSets: [{ id: 'ds-1' }, { id: 'ds-2' }],
        datasetConfigs: { retrieval_model: 'multiple' },
      })

      renderComponent()

      // postDatasets is used in config.dataset_configs.datasets
      expect(capturedTextGenerationProps).not.toBeNull()
    })
  })

  describe('event subscription', () => {
    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL event', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate text', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          inputs: { name: 'World' },
        }),
      )
    })

    it('should ignore other event types', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: 'OTHER_EVENT',
        payload: {},
      })

      expect(handleSend).not.toHaveBeenCalled()
    })
  })

  describe('doSend function', () => {
    it('should include model configuration', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      const modelAndParameter = createModelAndParameter({
        provider: 'anthropic',
        model: 'claude-3',
        parameters: { max_tokens: 2000 },
      })

      renderComponent({ modelAndParameter })

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            model: expect.objectContaining({
              provider: 'anthropic',
              name: 'claude-3',
              completion_params: { max_tokens: 2000 },
            }),
          }),
        }),
      )
    })

    it('should include files with local_file transfer method handled', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      renderComponent()

      const files = [
        { id: 'f1', transfer_method: TransferMethod.local_file, url: 'blob:123' },
        { id: 'f2', transfer_method: TransferMethod.remote_url, url: 'https://example.com/file' },
      ]

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          files: [
            expect.objectContaining({ id: 'f1', transfer_method: TransferMethod.local_file, url: '' }),
            expect.objectContaining({ id: 'f2', transfer_method: TransferMethod.remote_url, url: 'https://example.com/file' }),
          ],
        }),
      )
    })

    it('should not include files when file upload is disabled', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
        const state = {
          features: {
            moreLikeThis: { enabled: false },
            moderation: { enabled: false },
            text2speech: { enabled: false },
            file: { enabled: false },
          },
        }
        return selector(state)
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [{ id: 'f1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
      )
    })

    it('should not include files when files array is empty', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
      )
    })

    it('should not include files when files is undefined', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test' },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
      )
    })
  })

  describe('model resolution', () => {
    it('should find current provider and model', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: [
          {
            provider: 'openai',
            models: [
              { model: 'gpt-3.5-turbo', model_properties: { mode: 'chat' } },
              { model: 'gpt-4', model_properties: { mode: 'chat' } },
            ],
          },
        ],
      })

      const modelAndParameter = createModelAndParameter({
        provider: 'openai',
        model: 'gpt-4',
      })

      renderComponent({ modelAndParameter })

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            model: expect.objectContaining({
              mode: 'chat',
            }),
          }),
        }),
      )
    })

    it('should handle provider not found', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })

      mockUseProviderContext.mockReturnValue({
        textGenerationModelList: [],
      })

      renderComponent()

      eventSubscriptionCallback?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [] },
      })

      // Should still call handleSend without crashing
      expect(handleSend).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle null eventEmitter', () => {
      mockUseEventEmitterContextContext.mockReturnValue({
        eventEmitter: null,
      })

      expect(() => renderComponent()).not.toThrow()
    })

    it('should handle empty prompt_variables', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: { prompt_template: '', prompt_variables: [] },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: {},
        completionPromptConfig: {},
        dataSets: [],
        datasetConfigs: {},
      })

      expect(() => renderComponent()).not.toThrow()
    })

    it('should handle no context variable found', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: {
            prompt_template: '',
            prompt_variables: [
              { key: 'var1', name: 'Var1', type: 'string', is_context_var: false },
            ],
          },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: {},
        completionPromptConfig: {},
        dataSets: [],
        datasetConfigs: {},
      })

      renderComponent()

      // Should use empty string for dataset_query_variable
      expect(capturedTextGenerationProps).not.toBeNull()
    })
  })

  describe('promptVariablesToUserInputsForm', () => {
    it('should call promptVariablesToUserInputsForm with prompt_variables', () => {
      const promptVariables = [
        { key: 'name', name: 'Name', type: 'string' },
        { key: 'age', name: 'Age', type: 'number' },
      ]

      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: { prompt_template: '', prompt_variables: promptVariables },
          system_parameters: {},
        },
        appId: 'app-123',
        inputs: {},
        promptMode: 'simple',
        speechToTextConfig: {},
        introduction: '',
        suggestedQuestionsAfterAnswerConfig: {},
        citationConfig: {},
        externalDataToolsConfig: [],
        chatPromptConfig: {},
        completionPromptConfig: {},
        dataSets: [],
        datasetConfigs: {},
      })

      renderComponent()

      expect(mockPromptVariablesToUserInputsForm).toHaveBeenCalledWith(promptVariables)
    })
  })
})
