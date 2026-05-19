import type { ComponentProps } from 'react'
import type { ConfigurationViewModel } from '../hooks/use-configuration'
import type AppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import type ConfigContext from '@/context/debug-configuration'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { AppModeEnum, ModelModeType } from '@/types/app'
import ConfigurationView from '../configuration-view'

vi.mock('@/app/components/app/app-publisher/features-wrapper', () => ({
  default: () => <div data-testid="app-publisher" />,
}))

vi.mock('@/app/components/app/configuration/config', () => ({
  default: () => <div data-testid="config-panel" />,
}))

vi.mock('@/app/components/app/configuration/debug', () => ({
  default: () => <div data-testid="debug-panel" />,
}))

vi.mock('@/app/components/app/configuration/config/agent-setting-button', () => ({
  default: () => <div data-testid="agent-setting-button" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: () => <div data-testid="model-parameter-modal" />,
}))

vi.mock('@/app/components/app/configuration/dataset-config/select-dataset', () => ({
  default: () => <div data-testid="select-dataset" />,
}))

vi.mock('@/app/components/app/configuration/config-prompt/conversation-history/edit-modal', () => ({
  default: () => <div data-testid="history-modal" />,
}))

vi.mock('@/app/components/base/features/new-feature-panel', () => ({
  default: () => <div data-testid="feature-panel" />,
}))

vi.mock('@/app/components/workflow/plugin-dependency', () => ({
  default: () => <div data-testid="plugin-dependency" />,
}))

const createContextValue = (): ComponentProps<typeof ConfigContext.Provider>['value'] => ({
  appId: 'app-1',
  isAPIKeySet: true,
  isTrailFinished: false,
  mode: AppModeEnum.CHAT,
  modelModeType: ModelModeType.chat,
  promptMode: 'simple' as never,
  setPromptMode: vi.fn(),
  isAdvancedMode: false,
  isAgent: false,
  isFunctionCall: false,
  isOpenAI: false,
  collectionList: [],
  canReturnToSimpleMode: false,
  setCanReturnToSimpleMode: vi.fn(),
  chatPromptConfig: { prompt: [] } as never,
  completionPromptConfig: {
    prompt: { text: '' },
    conversation_histories_role: {
      user_prefix: 'user',
      assistant_prefix: 'assistant',
    },
  } as never,
  currentAdvancedPrompt: [],
  setCurrentAdvancedPrompt: vi.fn(),
  showHistoryModal: vi.fn(),
  conversationHistoriesRole: {
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  },
  setConversationHistoriesRole: vi.fn(),
  hasSetBlockStatus: {
    context: false,
    history: true,
    query: true,
  },
  conversationId: '',
  setConversationId: vi.fn(),
  introduction: '',
  setIntroduction: vi.fn(),
  suggestedQuestions: [],
  setSuggestedQuestions: vi.fn(),
  controlClearChatMessage: 0,
  setControlClearChatMessage: vi.fn(),
  prevPromptConfig: {
    prompt_template: '',
    prompt_variables: [],
  },
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
    score_threshold: 0.5,
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
    model_id: 'gpt-4o',
    mode: ModelModeType.chat,
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
    chat_prompt_config: null,
    completion_prompt_config: null,
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
    system_parameters: {
      audio_file_size_limit: 1,
      file_size_limit: 1,
      image_file_size_limit: 1,
      video_file_size_limit: 1,
      workflow_file_upload_limit: 1,
    },
    dataSets: [],
    agentConfig: {
      enabled: false,
      strategy: 'react',
      max_iteration: 1,
      tools: [],
    },
  } as never,
  setModelConfig: vi.fn(),
  dataSets: [],
  setDataSets: vi.fn(),
  showSelectDataSet: vi.fn(),
  datasetConfigs: {
    retrieval_model: 'multiple',
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
    datasets: { datasets: [] },
  } as never,
  datasetConfigsRef: { current: {} as never },
  setDatasetConfigs: vi.fn(),
  hasSetContextVar: false,
  isShowVisionConfig: false,
  visionConfig: {
    enabled: false,
    number_limits: 1,
    detail: 'low',
    transfer_methods: ['local_file'],
  } as never,
  setVisionConfig: vi.fn(),
  isAllowVideoUpload: false,
  isShowDocumentConfig: false,
  isShowAudioConfig: false,
  rerankSettingModalOpen: false,
  setRerankSettingModalOpen: vi.fn(),
})

const createViewModel = (overrides: Partial<ConfigurationViewModel> = {}): ConfigurationViewModel => ({
  appPublisherProps: {
    publishDisabled: false,
    publishedAt: 0,
    debugWithMultipleModel: false,
    multipleModelConfigs: [],
    onPublish: vi.fn(),
    publishedConfig: {
      modelConfig: createContextValue().modelConfig,
      completionParams: {},
    },
    resetAppConfig: vi.fn(),
  } as ComponentProps<typeof AppPublisher>,
  contextValue: createContextValue(),
  featuresData: {
    moreLikeThis: { enabled: false },
    opening: { enabled: false, opening_statement: '', suggested_questions: [] },
    moderation: { enabled: false },
    speech2text: { enabled: false },
    text2speech: { enabled: false, voice: '', language: '' },
    file: { enabled: false, image: { enabled: false, detail: 'high', number_limits: 3, transfer_methods: ['local_file'] } } as never,
    suggested: { enabled: false },
    citation: { enabled: false },
    annotationReply: { enabled: false },
  },
  isAgent: false,
  isAdvancedMode: false,
  isMobile: false,
  isShowDebugPanel: false,
  isShowHistoryModal: false,
  isShowSelectDataSet: false,
  modelConfig: createContextValue().modelConfig,
  multipleModelConfigs: [],
  onAutoAddPromptVariable: vi.fn(),
  onAgentSettingChange: vi.fn(),
  onCloseFeaturePanel: vi.fn(),
  onCloseHistoryModal: vi.fn(),
  onCloseSelectDataSet: vi.fn(),
  onCompletionParamsChange: vi.fn(),
  onConfirmUseGPT4: vi.fn(),
  onEnableMultipleModelDebug: vi.fn(),
  onFeaturesChange: vi.fn(),
  onHideDebugPanel: vi.fn(),
  onModelChange: vi.fn(),
  onMultipleModelConfigsChange: vi.fn(),
  onOpenAccountSettings: vi.fn(),
  onOpenDebugPanel: vi.fn(),
  onSaveHistory: vi.fn(),
  onSelectDataSets: vi.fn(),
  promptVariables: [],
  selectedIds: [],
  showAppConfigureFeaturesModal: false,
  showLoading: false,
  showUseGPT4Confirm: false,
  setShowUseGPT4Confirm: vi.fn(),
  ...overrides,
})

describe('ConfigurationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a loading state before configuration data is ready', () => {
    render(<ConfigurationView {...createViewModel({ showLoading: true })} />)

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('app-publisher')).not.toBeInTheDocument()
  })

  it('should open the mobile debug panel from the header button', () => {
    const onOpenDebugPanel = vi.fn()
    render(<ConfigurationView {...createViewModel({ isMobile: true, onOpenDebugPanel })} />)

    fireEvent.click(screen.getByRole('button', { name: /appDebug.operation.debugConfig/i }))

    expect(onOpenDebugPanel).toHaveBeenCalledTimes(1)
  })

  it('should close the GPT-4 confirmation dialog when cancel is clicked', () => {
    const setShowUseGPT4Confirm = vi.fn()
    render(<ConfigurationView {...createViewModel({ showUseGPT4Confirm: true, setShowUseGPT4Confirm })} />)

    fireEvent.click(screen.getByRole('button', { name: /operation.cancel/i }))

    expect(setShowUseGPT4Confirm).toHaveBeenCalledWith(false)
  })
})
