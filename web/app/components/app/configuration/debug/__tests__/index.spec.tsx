import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, ModelModeType, TransferMethod } from '@/types/app'
import Debug from '../index'
import { APP_CHAT_WITH_MULTIPLE_MODEL, APP_CHAT_WITH_MULTIPLE_MODEL_RESTART } from '../types'

type DebugContextValue = ComponentProps<typeof ConfigContext.Provider>['value']
type DebugProps = ComponentProps<typeof Debug>

const mockState = vi.hoisted(() => ({
  mockSendCompletionMessage: vi.fn(),
  mockHandleRestart: vi.fn(),
  mockSetFeatures: vi.fn(),
  mockEventEmitterEmit: vi.fn(),
  mockToastCall: vi.fn(),
  mockToastDismiss: vi.fn(),
  mockToastUpdate: vi.fn(),
  mockToastPromise: vi.fn(),
  mockText2speechDefaultModel: null as unknown,
  mockStoreState: {
    currentLogItem: null as unknown,
    setCurrentLogItem: vi.fn(),
    showPromptLogModal: false,
    setShowPromptLogModal: vi.fn(),
    showAgentLogModal: false,
    setShowAgentLogModal: vi.fn(),
  },
  mockFeaturesState: {
    moreLikeThis: { enabled: false },
    moderation: { enabled: false },
    text2speech: { enabled: false },
    file: { enabled: false, allowed_file_upload_methods: [] as string[], fileUploadConfig: undefined as { image_file_size_limit?: number } | undefined },
  },
  mockProviderContext: {
    textGenerationModelList: [] as Array<{
      provider: string
      models: Array<{
        model: string
        features?: string[]
        model_properties: { mode?: string }
      }>
    }>,
  },
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: Object.assign(mockState.mockToastCall, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      mockState.mockToastCall({ type: 'success', message, ...options })),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      mockState.mockToastCall({ type: 'error', message, ...options })),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      mockState.mockToastCall({ type: 'warning', message, ...options })),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      mockState.mockToastCall({ type: 'info', message, ...options })),
    dismiss: mockState.mockToastDismiss,
    update: mockState.mockToastUpdate,
    promise: mockState.mockToastPromise,
  }),
}))

vi.mock('@/app/components/app/configuration/debug/chat-user-input', () => ({
  default: () => <div data-testid="chat-user-input">ChatUserInput</div>,
}))

vi.mock('@/app/components/app/configuration/prompt-value-panel', () => ({
  default: ({ onSend, onVisionFilesChange }: {
    onSend: () => void
    onVisionFilesChange: (files: Array<Record<string, unknown>>) => void
  }) => (
    <div data-testid="prompt-value-panel">
      <button type="button" data-testid="panel-send" onClick={onSend}>Send</button>
      <button
        type="button"
        data-testid="panel-set-pending-file"
        onClick={() => onVisionFilesChange([{ transfer_method: TransferMethod.local_file }])}
      >
        Pending File
      </button>
      <button
        type="button"
        data-testid="panel-set-uploaded-file"
        onClick={() => onVisionFilesChange([{ transfer_method: TransferMethod.local_file, upload_file_id: 'file-id' }])}
      >
        Uploaded File
      </button>
      <button
        type="button"
        data-testid="panel-set-remote-file"
        onClick={() => onVisionFilesChange([{ transfer_method: TransferMethod.remote_url, url: 'https://example.com/file.png' }])}
      >
        Remote File
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: {
    currentLogItem: unknown
    setCurrentLogItem: () => void
    showPromptLogModal: boolean
    setShowPromptLogModal: () => void
    showAgentLogModal: boolean
    setShowAgentLogModal: () => void
  }) => unknown) => selector(mockState.mockStoreState),
}))

vi.mock('@/app/components/app/text-generate/item', () => ({
  default: ({ content, isLoading, isShowTextToSpeech, messageId }: {
    content: string
    isLoading: boolean
    isShowTextToSpeech: boolean
    messageId: string | null
  }) => (
    <div
      data-testid="text-generation"
      data-loading={isLoading ? 'true' : 'false'}
      data-tts={isShowTextToSpeech ? 'true' : 'false'}
      data-message-id={messageId || ''}
    >
      {content}
    </div>
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick, state }: { children: React.ReactNode, onClick?: () => void, state?: string }) => (
    <button type="button" data-testid="action-button" data-state={state} onClick={onClick}>
      {children}
    </button>
  ),
  ActionButtonState: {
    Active: 'active',
  },
}))

vi.mock('@/app/components/base/agent-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="agent-log-modal">
      <button type="button" data-testid="agent-log-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: { features: {
    moreLikeThis: { enabled: boolean }
    moderation: { enabled: boolean }
    text2speech: { enabled: boolean }
    file: { enabled: boolean, allowed_file_upload_methods: string[], fileUploadConfig?: { image_file_size_limit?: number } }
  } }) => unknown) => selector({ features: mockState.mockFeaturesState }),
  useFeaturesStore: () => ({
    getState: () => ({
      features: mockState.mockFeaturesState,
      setFeatures: mockState.mockSetFeatures,
    }),
  }),
}))

vi.mock('@/app/components/base/prompt-log-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="prompt-log-modal">
      <button type="button" data-testid="prompt-log-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: mockState.mockText2speechDefaultModel }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { emit: mockState.mockEventEmitterEmit },
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockState.mockProviderContext,
}))

vi.mock('@/service/debug', () => ({
  sendCompletionMessage: mockState.mockSendCompletionMessage,
}))

vi.mock('../../base/group-name', () => ({
  default: ({ name }: { name: string }) => <div>{name}</div>,
}))

vi.mock('../../base/warning-mask/cannot-query-dataset', () => ({
  default: ({ onConfirm }: { onConfirm: () => void }) => (
    <div data-testid="cannot-query-dataset">
      <button type="button" data-testid="cannot-query-confirm" onClick={onConfirm}>Confirm</button>
    </div>
  ),
}))

vi.mock('../../base/warning-mask/formatting-changed', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div data-testid="formatting-changed">
      <button type="button" data-testid="formatting-confirm" onClick={onConfirm}>Confirm</button>
      <button type="button" data-testid="formatting-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('../debug-with-multiple-model', () => ({
  default: ({
    checkCanSend,
    onDebugWithMultipleModelChange,
  }: {
    checkCanSend: () => boolean
    onDebugWithMultipleModelChange: (item: { id: string, model: string, provider: string, parameters: Record<string, unknown> }) => void
  }) => (
    <div data-testid="debug-with-multiple-model">
      <button type="button" data-testid="multiple-check-can-send" onClick={() => checkCanSend()}>Check</button>
      <button
        type="button"
        data-testid="multiple-switch-to-single"
        onClick={() => onDebugWithMultipleModelChange({
          id: 'model-1',
          model: 'vision-model',
          provider: 'openai',
          parameters: { temperature: 0.2 },
        })}
      >
        Switch
      </button>
    </div>
  ),
}))

vi.mock('../debug-with-single-model', () => {
  function DebugWithSingleModelMock({
    checkCanSend,
    ref,
  }: {
    checkCanSend: () => boolean
    ref?: React.Ref<{ handleRestart: () => void }>
  }) {
    React.useImperativeHandle(ref, () => ({
      handleRestart: mockState.mockHandleRestart,
    }))

    return (
      <div data-testid="debug-with-single-model">
        <button type="button" data-testid="single-check-can-send" onClick={() => checkCanSend()}>Check</button>
      </div>
    )
  }

  return { default: DebugWithSingleModelMock }
})

const createContextValue = (overrides: Partial<DebugContextValue> = {}): DebugContextValue => ({
  readonly: false,
  appId: 'app-id',
  isAPIKeySet: true,
  isTrailFinished: false,
  mode: AppModeEnum.CHAT,
  modelModeType: ModelModeType.chat,
  promptMode: 'simple' as DebugContextValue['promptMode'],
  setPromptMode: vi.fn(),
  isAdvancedMode: false,
  isAgent: false,
  isFunctionCall: false,
  isOpenAI: true,
  collectionList: [],
  canReturnToSimpleMode: false,
  setCanReturnToSimpleMode: vi.fn(),
  chatPromptConfig: { prompt: [] } as DebugContextValue['chatPromptConfig'],
  completionPromptConfig: {
    prompt: { text: '' },
    conversation_histories_role: { user_prefix: 'user', assistant_prefix: 'assistant' },
  } as DebugContextValue['completionPromptConfig'],
  currentAdvancedPrompt: [],
  setCurrentAdvancedPrompt: vi.fn(),
  showHistoryModal: vi.fn(),
  conversationHistoriesRole: { user_prefix: 'user', assistant_prefix: 'assistant' },
  setConversationHistoriesRole: vi.fn(),
  hasSetBlockStatus: { context: false, history: true, query: true },
  conversationId: null,
  setConversationId: vi.fn(),
  introduction: '',
  setIntroduction: vi.fn(),
  suggestedQuestions: [],
  setSuggestedQuestions: vi.fn(),
  controlClearChatMessage: 0,
  setControlClearChatMessage: vi.fn(),
  prevPromptConfig: { prompt_template: '', prompt_variables: [] },
  setPrevPromptConfig: vi.fn(),
  moreLikeThisConfig: { enabled: false },
  setMoreLikeThisConfig: vi.fn(),
  suggestedQuestionsAfterAnswerConfig: { enabled: false },
  setSuggestedQuestionsAfterAnswerConfig: vi.fn(),
  speechToTextConfig: { enabled: false },
  setSpeechToTextConfig: vi.fn(),
  textToSpeechConfig: { enabled: false, voice: '', language: '' },
  setTextToSpeechConfig: vi.fn(),
  citationConfig: { enabled: false },
  setCitationConfig: vi.fn(),
  annotationConfig: {
    id: '',
    enabled: false,
    score_threshold: 0.7,
    embedding_model: {
      embedding_model_name: '',
      embedding_provider_name: '',
    },
  },
  setAnnotationConfig: vi.fn(),
  moderationConfig: { enabled: false },
  setModerationConfig: vi.fn(),
  externalDataToolsConfig: [],
  setExternalDataToolsConfig: vi.fn(),
  formattingChanged: false,
  setFormattingChanged: vi.fn(),
  inputs: {},
  setInputs: vi.fn(),
  query: '',
  setQuery: vi.fn(),
  completionParams: {},
  setCompletionParams: vi.fn(),
  modelConfig: {
    provider: 'openai',
    model_id: 'gpt-4',
    mode: ModelModeType.chat,
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
    chat_prompt_config: { prompt: [] },
    completion_prompt_config: {
      prompt: { text: '' },
      conversation_histories_role: { user_prefix: 'user', assistant_prefix: 'assistant' },
    },
    more_like_this: null,
    opening_statement: '',
    suggested_questions: [],
    sensitive_word_avoidance: null,
    speech_to_text: null,
    text_to_speech: null,
    file_upload: null,
    suggested_questions_after_answer: null,
    retriever_resource: null,
    annotation_reply: null,
    external_data_tools: [],
    system_parameters: {
      audio_file_size_limit: 0,
      file_size_limit: 0,
      image_file_size_limit: 0,
      video_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    },
    dataSets: [],
    agentConfig: {
      enabled: false,
      max_iteration: 5,
      tools: [],
      strategy: 'react',
    },
  } as DebugContextValue['modelConfig'],
  setModelConfig: vi.fn(),
  dataSets: [],
  setDataSets: vi.fn(),
  showSelectDataSet: vi.fn(),
  datasetConfigs: {
    retrieval_model: 'single',
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 4,
    score_threshold_enabled: false,
    score_threshold: 0.7,
    datasets: { datasets: [] },
  } as DebugContextValue['datasetConfigs'],
  datasetConfigsRef: { current: null } as unknown as DebugContextValue['datasetConfigsRef'],
  setDatasetConfigs: vi.fn(),
  hasSetContextVar: false,
  isShowVisionConfig: false,
  visionConfig: {
    enabled: false,
    number_limits: 2,
    detail: 'low',
    transfer_methods: [],
  } as DebugContextValue['visionConfig'],
  setVisionConfig: vi.fn(),
  isAllowVideoUpload: false,
  isShowDocumentConfig: false,
  isShowAudioConfig: false,
  rerankSettingModalOpen: false,
  setRerankSettingModalOpen: vi.fn(),
  ...overrides,
})

const renderDebug = (options: {
  contextValue?: Partial<DebugContextValue>
  props?: Partial<DebugProps>
} = {}) => {
  const onSetting = vi.fn()
  const props: ComponentProps<typeof Debug> = {
    isAPIKeySet: true,
    onSetting,
    inputs: {},
    modelParameterParams: {
      setModel: vi.fn(),
      onCompletionParamsChange: vi.fn(),
    },
    debugWithMultipleModel: false,
    multipleModelConfigs: [],
    onMultipleModelConfigsChange: vi.fn(),
    ...options.props,
  }

  render(
    React.createElement(
      ConfigContext.Provider,
      {
        value: createContextValue(options.contextValue),
        children: <Debug {...props} />,
      },
    ),
  )

  return { onSetting, notify: mockState.mockToastCall, props }
}

describe('Debug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.mockSendCompletionMessage.mockReset()
    mockState.mockHandleRestart.mockReset()
    mockState.mockSetFeatures.mockReset()
    mockState.mockEventEmitterEmit.mockReset()
    mockState.mockText2speechDefaultModel = null
    mockState.mockStoreState = {
      currentLogItem: null,
      setCurrentLogItem: vi.fn(),
      showPromptLogModal: false,
      setShowPromptLogModal: vi.fn(),
      showAgentLogModal: false,
      setShowAgentLogModal: vi.fn(),
    }
    mockState.mockFeaturesState = {
      moreLikeThis: { enabled: false },
      moderation: { enabled: false },
      text2speech: { enabled: false },
      file: { enabled: false, allowed_file_upload_methods: [], fileUploadConfig: undefined },
    }
    mockState.mockProviderContext = {
      textGenerationModelList: [{
        provider: 'openai',
        models: [{
          model: 'vision-model',
          features: [ModelFeatureEnum.vision],
          model_properties: { mode: 'chat' },
        }],
      }],
    }
  })

  describe('Empty states', () => {
    it('should render no-provider empty state and forward manage action', () => {
      const { onSetting } = renderDebug({
        contextValue: {
          modelConfig: {
            ...createContextValue().modelConfig,
            provider: '',
            model_id: '',
          },
        },
        props: {
          isAPIKeySet: false,
        },
      })

      expect(screen.getByText('appDebug.noModelProviderConfigured'))!.toBeInTheDocument()
      expect(screen.getByText('appDebug.noModelProviderConfiguredTip'))!.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'appDebug.manageModels' }))
      expect(onSetting).toHaveBeenCalledTimes(1)
    })

    it('should render no-model-selected empty state when provider exists but model is missing', () => {
      renderDebug({
        contextValue: {
          modelConfig: {
            ...createContextValue().modelConfig,
            provider: 'openai',
            model_id: '',
          },
        },
        props: {
          isAPIKeySet: true,
        },
      })

      expect(screen.getByText('appDebug.noModelSelected'))!.toBeInTheDocument()
      expect(screen.getByText('appDebug.noModelSelectedTip'))!.toBeInTheDocument()
      expect(screen.queryByText('appDebug.noModelProviderConfigured')).not.toBeInTheDocument()
    })
  })

  describe('Single model mode', () => {
    it('should render single-model panel and refresh conversation', () => {
      renderDebug()

      expect(screen.getByTestId('debug-with-single-model'))!.toBeInTheDocument()

      fireEvent.click(screen.getAllByTestId('action-button')[0]!)
      expect(mockState.mockHandleRestart).toHaveBeenCalledTimes(1)
    })

    it('should toggle chat input visibility when variable panel button is clicked', () => {
      renderDebug({
        contextValue: {
          inputs: { question: 'hello' },
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [{
                key: 'question',
                name: 'Question',
                type: 'string',
                required: true,
              }] as DebugContextValue['modelConfig']['configs']['prompt_variables'],
            },
          },
        },
      })

      expect(screen.getByTestId('chat-user-input'))!.toBeInTheDocument()
      fireEvent.click(screen.getAllByTestId('action-button')[1]!)
      expect(screen.queryByTestId('chat-user-input')).not.toBeInTheDocument()
    })

    it('should not render refresh action when readonly is true', () => {
      renderDebug({
        contextValue: {
          readonly: true,
        },
      })

      expect(screen.queryByTestId('action-button')).not.toBeInTheDocument()
    })

    it('should show formatting confirmation and handle cancel', () => {
      const setFormattingChanged = vi.fn()

      renderDebug({
        contextValue: {
          formattingChanged: true,
          setFormattingChanged,
        },
      })

      expect(screen.getByTestId('formatting-changed'))!.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('formatting-cancel'))
      expect(setFormattingChanged).toHaveBeenCalledWith(false)
    })

    it('should handle formatting confirmation with restart', () => {
      const setFormattingChanged = vi.fn()

      renderDebug({
        contextValue: {
          formattingChanged: true,
          setFormattingChanged,
        },
      })

      fireEvent.click(screen.getByTestId('formatting-confirm'))
      expect(setFormattingChanged).toHaveBeenCalledWith(false)
      expect(mockState.mockHandleRestart).toHaveBeenCalledTimes(1)
    })

    it('should notify when history block is missing in advanced completion mode', () => {
      const { notify } = renderDebug({
        contextValue: {
          isAdvancedMode: true,
          mode: AppModeEnum.CHAT,
          modelModeType: ModelModeType.completion,
          hasSetBlockStatus: { context: false, history: false, query: true },
        },
      })

      fireEvent.click(screen.getByTestId('single-check-can-send'))
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'appDebug.otherError.historyNoBeEmpty',
      })
    })

    it('should notify when query block is missing in advanced completion mode', () => {
      const { notify } = renderDebug({
        contextValue: {
          isAdvancedMode: true,
          mode: AppModeEnum.CHAT,
          modelModeType: ModelModeType.completion,
          hasSetBlockStatus: { context: false, history: true, query: false },
        },
      })

      fireEvent.click(screen.getByTestId('single-check-can-send'))
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'appDebug.otherError.queryNoBeEmpty',
      })
    })
  })

  describe('Completion mode', () => {
    it('should render prompt value panel and no-result placeholder', () => {
      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
        },
      })

      expect(screen.getByTestId('prompt-value-panel'))!.toBeInTheDocument()
      expect(screen.getByText('appDebug.noResult'))!.toBeInTheDocument()
    })

    it('should notify when required input is missing', () => {
      const { notify } = renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          inputs: {},
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [{
                key: 'question',
                name: 'Question',
                type: 'string',
                required: true,
              }] as DebugContextValue['modelConfig']['configs']['prompt_variables'],
            },
          },
        },
      })

      fireEvent.click(screen.getByTestId('panel-send'))
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'appDebug.errorMessage.valueOfVarRequired:{"key":"Question"}',
      })
      expect(mockState.mockSendCompletionMessage).not.toHaveBeenCalled()
    })

    it('should notify when local file upload is still pending', () => {
      const { notify } = renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [],
            },
          },
        },
      })

      fireEvent.click(screen.getByTestId('panel-set-pending-file'))
      fireEvent.click(screen.getByTestId('panel-send'))

      expect(notify).toHaveBeenCalledWith({
        type: 'info',
        message: 'appDebug.errorMessage.waitForFileUpload',
      })
      expect(mockState.mockSendCompletionMessage).not.toHaveBeenCalled()
    })

    it('should show cannot-query-dataset warning when dataset context variable is missing', () => {
      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          dataSets: [{ id: 'dataset-1' }] as DebugContextValue['dataSets'],
          hasSetContextVar: false,
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [],
            },
          },
        },
      })

      fireEvent.click(screen.getByTestId('panel-send'))
      expect(screen.getByTestId('cannot-query-dataset'))!.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('cannot-query-confirm'))
      expect(screen.queryByTestId('cannot-query-dataset')).not.toBeInTheDocument()
    })

    it('should send completion request and render completion result', async () => {
      mockState.mockText2speechDefaultModel = { provider: 'openai' }
      mockState.mockFeaturesState = {
        ...mockState.mockFeaturesState,
        text2speech: { enabled: true },
        file: {
          enabled: true,
          allowed_file_upload_methods: [],
          fileUploadConfig: { image_file_size_limit: 2 },
        },
      }

      mockState.mockSendCompletionMessage.mockImplementation((_appId, _data, handlers: {
        onData: (chunk: string, isFirst: boolean, payload: { messageId: string }) => void
        onMessageReplace: (payload: { answer: string }) => void
        onCompleted: () => void
        onError: () => void
      }) => {
        handlers.onData('hello', true, { messageId: 'msg-1' })
        handlers.onMessageReplace({ answer: 'final answer' })
        handlers.onCompleted()
      })

      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          promptMode: 'simple' as DebugContextValue['promptMode'],
          textToSpeechConfig: { enabled: true, voice: 'alloy', language: 'en' },
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: 'Prompt',
              prompt_variables: [{
                key: 'question',
                name: 'Question',
                type: 'string',
                required: true,
                is_context_var: true,
              }] as DebugContextValue['modelConfig']['configs']['prompt_variables'],
            },
          },
        },
        props: {
          inputs: { question: 'hello' },
        },
      })

      fireEvent.click(screen.getByTestId('panel-send'))

      await waitFor(() => expect(mockState.mockSendCompletionMessage).toHaveBeenCalledTimes(1))
      const [, requestData] = (mockState.mockSendCompletionMessage.mock.calls[0] ?? []) as [unknown, any]
      expect(requestData).toMatchObject({
        inputs: { question: 'hello' },
        model_config: {
          model: {
            provider: 'openai',
            name: 'gpt-4',
          },
          dataset_query_variable: 'question',
        },
      })
      expect(screen.getByTestId('text-generation'))!.toHaveTextContent('final answer')
      expect(screen.getByTestId('text-generation'))!.toHaveAttribute('data-message-id', 'msg-1')
      expect(screen.getByTestId('text-generation'))!.toHaveAttribute('data-tts', 'true')
    })

    it('should notify when sending again while a response is in progress', async () => {
      mockState.mockSendCompletionMessage.mockImplementation(() => undefined)
      const { notify } = renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [],
            },
          },
        },
      })

      fireEvent.click(screen.getByTestId('panel-send'))
      fireEvent.click(screen.getByTestId('panel-send'))

      await waitFor(() => expect(mockState.mockSendCompletionMessage).toHaveBeenCalledTimes(1))
      expect(notify).toHaveBeenCalledWith({
        type: 'info',
        message: 'appDebug.errorMessage.waitForResponse',
      })
    })

    it('should keep remote files and reset responding state on send error', async () => {
      mockState.mockFeaturesState = {
        ...mockState.mockFeaturesState,
        file: {
          enabled: true,
          allowed_file_upload_methods: [],
          fileUploadConfig: undefined,
        },
      }

      mockState.mockSendCompletionMessage.mockImplementation((_appId, data, handlers: {
        onError: () => void
      }) => {
        expect(data.files).toEqual([{
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/file.png',
        }])
        handlers.onError()
      })

      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [],
            },
          },
        },
      })

      fireEvent.click(screen.getByTestId('panel-set-remote-file'))
      fireEvent.click(screen.getByTestId('panel-send'))

      await waitFor(() => expect(mockState.mockSendCompletionMessage).toHaveBeenCalledTimes(1))
      expect(screen.getByText('appDebug.noResult'))!.toBeInTheDocument()
    })

    it('should render prompt log modal in completion mode when store flag is enabled', () => {
      mockState.mockStoreState = {
        ...mockState.mockStoreState,
        showPromptLogModal: true,
      }

      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
        },
      })

      expect(screen.getByTestId('prompt-log-modal'))!.toBeInTheDocument()
    })

    it('should close prompt log modal in completion mode', () => {
      const setCurrentLogItem = vi.fn()
      const setShowPromptLogModal = vi.fn()

      mockState.mockStoreState = {
        ...mockState.mockStoreState,
        currentLogItem: { id: 'log-1' },
        setCurrentLogItem,
        showPromptLogModal: true,
        setShowPromptLogModal,
      }

      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
        },
      })

      fireEvent.click(screen.getByTestId('prompt-log-cancel'))
      expect(setCurrentLogItem).toHaveBeenCalledTimes(1)
      expect(setShowPromptLogModal).toHaveBeenCalledWith(false)
    })
  })

  describe('Multiple model mode', () => {
    it('should append a blank model when add-model button is clicked', () => {
      const onMultipleModelConfigsChange = vi.fn()

      renderDebug({
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: 'model-1', model: 'vision-model', provider: 'openai', parameters: {} }],
          onMultipleModelConfigsChange,
        },
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.modelProvider.addModel(1/4)' }))
      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [
        { id: 'model-1', model: 'vision-model', provider: 'openai', parameters: {} },
        expect.objectContaining({ model: '', provider: '', parameters: {} }),
      ])
    })

    it('should disable add-model button when there are already four models', () => {
      renderDebug({
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [
            { id: '1', model: 'a', provider: 'p', parameters: {} },
            { id: '2', model: 'b', provider: 'p', parameters: {} },
            { id: '3', model: 'c', provider: 'p', parameters: {} },
            { id: '4', model: 'd', provider: 'p', parameters: {} },
          ],
        },
      })

      expect(screen.getByRole('button', { name: 'common.modelProvider.addModel(4/4)' }))!.toBeDisabled()
    })

    it('should emit completion event in multiple-model completion mode', () => {
      renderDebug({
        contextValue: {
          mode: AppModeEnum.COMPLETION,
          modelConfig: {
            ...createContextValue().modelConfig,
            configs: {
              prompt_template: '',
              prompt_variables: [],
            },
          },
        },
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: '1', model: 'vision-model', provider: 'openai', parameters: {} }],
        },
      })

      fireEvent.click(screen.getByTestId('panel-set-uploaded-file'))
      fireEvent.click(screen.getByTestId('panel-send'))

      expect(mockState.mockEventEmitterEmit).toHaveBeenCalledWith({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: {
          message: '',
          files: [{ transfer_method: TransferMethod.local_file, upload_file_id: 'file-id' }],
        },
      })
    })

    it('should emit restart event when refresh is clicked in multiple-model mode', () => {
      renderDebug({
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: '1', model: 'vision-model', provider: 'openai', parameters: {} }],
        },
      })

      fireEvent.click(screen.getAllByTestId('action-button')[0]!)
      expect(mockState.mockEventEmitterEmit).toHaveBeenCalledWith({
        type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
      })
    })

    it('should switch from multiple model to single model with selected parameters', () => {
      const setModel = vi.fn()
      const onCompletionParamsChange = vi.fn()
      const onMultipleModelConfigsChange = vi.fn()

      renderDebug({
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: 'model-1', model: 'vision-model', provider: 'openai', parameters: { temperature: 0.2 } }],
          onMultipleModelConfigsChange,
          modelParameterParams: {
            setModel,
            onCompletionParamsChange,
          },
        },
      })

      fireEvent.click(screen.getByTestId('multiple-switch-to-single'))

      expect(setModel).toHaveBeenCalledWith({
        modelId: 'vision-model',
        provider: 'openai',
        mode: 'chat',
        features: [ModelFeatureEnum.vision],
      })
      expect(onCompletionParamsChange).toHaveBeenCalledWith({ temperature: 0.2 })
      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(false, [])
    })

    it('should update feature store according to multiple-model vision support', () => {
      renderDebug({
        contextValue: {
          mode: AppModeEnum.CHAT,
        },
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: '1', model: 'vision-model', provider: 'openai', parameters: {} }],
        },
      })

      expect(mockState.mockSetFeatures).toHaveBeenCalledWith(expect.objectContaining({
        file: expect.objectContaining({
          enabled: true,
        }),
      }))
    })

    it('should render prompt and agent log modals in multiple-model mode', () => {
      mockState.mockStoreState = {
        ...mockState.mockStoreState,
        showPromptLogModal: true,
        showAgentLogModal: true,
      }

      renderDebug({
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: '1', model: 'vision-model', provider: 'openai', parameters: {} }],
        },
      })

      expect(screen.getByTestId('prompt-log-modal'))!.toBeInTheDocument()
      expect(screen.getByTestId('agent-log-modal'))!.toBeInTheDocument()
    })

    it('should close prompt and agent log modals in multiple-model mode', () => {
      const setCurrentLogItem = vi.fn()
      const setShowPromptLogModal = vi.fn()
      const setShowAgentLogModal = vi.fn()

      mockState.mockStoreState = {
        ...mockState.mockStoreState,
        currentLogItem: { id: 'log-1' },
        setCurrentLogItem,
        showPromptLogModal: true,
        setShowPromptLogModal,
        showAgentLogModal: true,
        setShowAgentLogModal,
      }

      renderDebug({
        props: {
          debugWithMultipleModel: true,
          multipleModelConfigs: [{ id: '1', model: 'vision-model', provider: 'openai', parameters: {} }],
        },
      })

      fireEvent.click(screen.getByTestId('prompt-log-cancel'))
      fireEvent.click(screen.getByTestId('agent-log-cancel'))

      expect(setCurrentLogItem).toHaveBeenCalledTimes(2)
      expect(setShowPromptLogModal).toHaveBeenCalledWith(false)
      expect(setShowAgentLogModal).toHaveBeenCalledWith(false)
    })
  })
})
