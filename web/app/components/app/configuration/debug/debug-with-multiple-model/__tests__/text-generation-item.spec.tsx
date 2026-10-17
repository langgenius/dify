import type { ReactElement, ReactNode } from 'react'
import type { ModelAndParameter } from '../../types'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Log from '@/app/components/base/chat/chat/log'
import { TransferMethod } from '@/app/components/base/chat/types'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../../types'
import { DebugWithMultipleModelContextProvider } from '../context-provider'
import TextGenerationItem from '../text-generation-item'

const mockUseDebugConfigurationContext = vi.fn()
const modelListResponse = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseTextGeneration = vi.fn()
const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

let capturedTextGenerationProps: {
  onOpenLog: (item: IChatItem) => void
  content: string
  isLoading: boolean
  isResponding: boolean
  messageId: string | null
  className?: string
} | null = null

let emitDebugEvent: ((v: { type: string; payload?: Record<string, unknown> }) => void) | null = null

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

vi.mock('@/app/components/base/text-generation/hooks', () => ({
  useTextGeneration: () => mockUseTextGeneration(),
}))

vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: (props: typeof capturedTextGenerationProps) => {
    capturedTextGenerationProps = props
    return (
      <div data-testid="text-generation">
        {props && (
          <Log
            logItem={{ id: props.messageId!, isAnswer: true, content: props.content }}
            onOpenLog={props.onOpenLog}
          />
        )}
        <span data-testid="content">{props?.content}</span>
        <span data-testid="is-loading">{props?.isLoading ? 'yes' : 'no'}</span>
        <span data-testid="is-responding">{props?.isResponding ? 'yes' : 'no'}</span>
        <span data-testid="message-id">{props?.messageId || 'null'}</span>
      </div>
    )
  },
}))

function EventSource({ children }: { children: ReactNode }) {
  const { eventEmitter } = useEventEmitterContextContext()
  emitDebugEvent = (event) => eventEmitter!.emit(event)
  return children
}

function render(ui: ReactElement) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    modelListResponse(),
  )
  return renderWithConsoleQuery(
    <EventEmitterContextProvider>
      <EventSource>{ui}</EventSource>
    </EventEmitterContextProvider>,
    { queryClient },
  )
}

const createModelAndParameter = (
  overrides: Partial<ModelAndParameter> = {},
): ModelAndParameter => ({
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
        prompt_variables: [{ key: 'name', name: 'Name', type: 'string', is_context_var: false }],
      },
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

  modelListResponse.mockReturnValue({
    data: [
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
    vi.resetAllMocks()
    capturedTextGenerationProps = null
    emitDebugEvent = null
    createDefaultMocks()
  })

  it('opens this model result through the owning debug session', async () => {
    const user = userEvent.setup()
    const onOpenLog = vi.fn()
    render(
      <DebugWithMultipleModelContextProvider
        multipleModelConfigs={[]}
        onMultipleModelConfigsChange={vi.fn()}
        onDebugWithMultipleModelChange={vi.fn()}
        onOpenLog={onOpenLog}
      >
        <TextGenerationItem modelAndParameter={createModelAndParameter()} />
      </DebugWithMultipleModelContextProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.log' }))
    expect(onOpenLog).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'msg-123', isAnswer: true }),
    )
  })

  describe('rendering', () => {
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate', files: [] },
      })
      expect(mockUseTextGeneration().handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          model_config: expect.objectContaining({ pre_prompt: 'My Template' }),
        }),
        expect.any(Object),
      )
    })

    it('should use empty pre_prompt in advanced mode', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: true,
        modelConfig: {
          configs: {
            prompt_template: 'Should not be used',
            prompt_variables: [],
          },
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate', files: [] },
      })
      expect(mockUseTextGeneration().handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          model_config: expect.objectContaining({
            pre_prompt: '',
            prompt_type: 'advanced',
            chat_prompt_config: { custom: true },
            completion_prompt_config: { custom: true },
          }),
        }),
        expect.any(Object),
      )
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate', files: [] },
      })
      expect(mockUseTextGeneration().handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          model_config: expect.objectContaining({ dataset_query_variable: 'context' }),
        }),
        expect.any(Object),
      )
    })
  })

  describe('dataset configuration', () => {
    it('should transform dataSets to postDatasets format', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: { prompt_template: '', prompt_variables: [] },
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate', files: [] },
      })
      expect(mockUseTextGeneration().handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          model_config: expect.objectContaining({
            dataset_configs: {
              retrieval_model: 'multiple',
              datasets: {
                datasets: [
                  { dataset: { enabled: true, id: 'ds-1' } },
                  { dataset: { enabled: true, id: 'ds-2' } },
                ],
              },
            },
          }),
        }),
        expect.any(Object),
      )
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate text', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          inputs: { name: 'World' },
        }),
        expect.objectContaining({
          onNotifyError: expect.any(Function),
        }),
      )

      const callbacks = handleSend.mock.calls[0]![2] as {
        onNotifyError: (message: string) => void
      }
      callbacks.onNotifyError('Base model not found')
      expect(mockToastError).toHaveBeenCalledWith('Base model not found')
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

      emitDebugEvent?.({
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

      emitDebugEvent?.({
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
        expect.objectContaining({ onNotifyError: expect.any(Function) }),
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          files: [
            expect.objectContaining({
              id: 'f1',
              transfer_method: TransferMethod.local_file,
              url: '',
            }),
            expect.objectContaining({
              id: 'f2',
              transfer_method: TransferMethod.remote_url,
              url: 'https://example.com/file',
            }),
          ],
        }),
        expect.objectContaining({ onNotifyError: expect.any(Function) }),
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

      mockUseFeatures.mockImplementation(
        (selector: (state: Record<string, unknown>) => unknown) => {
          const state = {
            features: {
              moreLikeThis: { enabled: false },
              moderation: { enabled: false },
              text2speech: { enabled: false },
              file: { enabled: false },
            },
          }
          return selector(state)
        },
      )

      renderComponent()

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [{ id: 'f1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
        expect.objectContaining({ onNotifyError: expect.any(Function) }),
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Test', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
        expect.objectContaining({ onNotifyError: expect.any(Function) }),
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

      modelListResponse.mockReturnValue({
        data: [
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

      emitDebugEvent?.({
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
        expect.objectContaining({ onNotifyError: expect.any(Function) }),
      )
    })
  })

  describe('promptVariablesToUserInputsForm', () => {
    it('sends the generated input schema with the completion request', () => {
      const handleSend = vi.fn()
      mockUseTextGeneration.mockReturnValue({
        completion: '',
        handleSend,
        isResponding: false,
        messageId: null,
      })
      const promptVariables = [
        { key: 'name', name: 'Name', type: 'string' },
        { key: 'age', name: 'Age', type: 'number' },
      ]

      mockUseDebugConfigurationContext.mockReturnValue({
        isAdvancedMode: false,
        modelConfig: {
          configs: { prompt_template: '', prompt_variables: promptVariables },
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

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Generate text', files: [] },
      })
      expect(handleSend).toHaveBeenCalledWith(
        'apps/app-123/completion-messages',
        expect.objectContaining({
          model_config: expect.objectContaining({
            user_input_form: [
              {
                'text-input': expect.objectContaining({
                  variable: 'name',
                  label: 'Name',
                  required: true,
                }),
              },
              {
                number: expect.objectContaining({ variable: 'age', label: 'Age', required: true }),
              },
            ],
          }),
        }),
        expect.any(Object),
      )
    })
  })
})
