import type { ConfigurationPublishConfig } from '@/app/components/app/configuration/hooks/configuration-lifecycle/types'
import type { useDebugConfigurationContext } from '@/context/debug-configuration'
import type { DatasetConfigs, ModelConfig } from '@/models/debug'
import { noop } from 'es-toolkit/function'
import {
  ANNOTATION_DEFAULT,
  DEFAULT_AGENT_SETTING,
  DEFAULT_CHAT_PROMPT_CONFIG,
  DEFAULT_COMPLETION_PROMPT_CONFIG,
} from '@/config'
import { PromptMode } from '@/models/debug'
import { ModelModeType, Resolution, RETRIEVE_TYPE, TransferMethod } from '@/types/app'

export const createModelConfigFixture = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  provider: 'OPENAI',
  model_id: 'gpt-3.5-turbo',
  mode: ModelModeType.unset,
  configs: {
    prompt_template: '',
    prompt_variables: [],
  },
  chat_prompt_config: structuredClone(DEFAULT_CHAT_PROMPT_CONFIG),
  completion_prompt_config: structuredClone(DEFAULT_COMPLETION_PROMPT_CONFIG),
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
  dataSets: [],
  agentConfig: structuredClone(DEFAULT_AGENT_SETTING),
  ...overrides,
})

export const createDatasetConfigsFixture = (
  overrides: Partial<DatasetConfigs> = {},
): DatasetConfigs => ({
  retrieval_model: RETRIEVE_TYPE.multiWay,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0.7,
  datasets: {
    datasets: [],
  },
  ...overrides,
})

export const createDebugConfigurationFixture = (
  overrides: Partial<ReturnType<typeof useDebugConfigurationContext>> = {},
): ReturnType<typeof useDebugConfigurationContext> => ({
  readonly: false,
  canTestAndRun: false,
  appId: '',
  onOpenFeatures: noop,
  isTrailFinished: false,
  mode: 'chat' as const,
  modelModeType: ModelModeType.chat,
  promptMode: PromptMode.simple,
  setPromptMode: noop,
  isAdvancedMode: false,
  isAgent: false,
  isFunctionCall: false,
  isOpenAI: false,
  collectionList: [],
  canReturnToSimpleMode: false,
  setCanReturnToSimpleMode: noop,
  chatPromptConfig: structuredClone(DEFAULT_CHAT_PROMPT_CONFIG),
  completionPromptConfig: structuredClone(DEFAULT_COMPLETION_PROMPT_CONFIG),
  currentAdvancedPrompt: [],
  showHistoryModal: noop,
  conversationHistoriesRole: {
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  },
  setConversationHistoriesRole: noop,
  setCurrentAdvancedPrompt: noop,
  hasSetBlockStatus: {
    context: false,
    history: false,
    query: false,
  },
  conversationId: '',
  setConversationId: noop,
  introduction: '',
  setIntroduction: noop,
  suggestedQuestions: [],
  setSuggestedQuestions: noop,
  controlClearChatMessage: 0,
  setControlClearChatMessage: noop,
  prevPromptConfig: {
    prompt_template: '',
    prompt_variables: [],
  },
  setPrevPromptConfig: noop,
  moreLikeThisConfig: {
    enabled: false,
  },
  setMoreLikeThisConfig: noop,
  suggestedQuestionsAfterAnswerConfig: {
    enabled: false,
  },
  setSuggestedQuestionsAfterAnswerConfig: noop,
  speechToTextConfig: {
    enabled: false,
  },
  setSpeechToTextConfig: noop,
  textToSpeechConfig: {
    enabled: false,
    voice: '',
    language: '',
  },
  setTextToSpeechConfig: noop,
  citationConfig: {
    enabled: false,
  },
  setCitationConfig: noop,
  moderationConfig: {
    enabled: false,
  },
  annotationConfig: {
    id: '',
    enabled: false,
    score_threshold: ANNOTATION_DEFAULT.score_threshold,
    embedding_model: {
      embedding_model_name: '',
      embedding_provider_name: '',
    },
  },
  setAnnotationConfig: noop,
  setModerationConfig: noop,
  externalDataToolsConfig: [],
  setExternalDataToolsConfig: noop,
  formattingChanged: false,
  setFormattingChanged: noop,
  inputs: {},
  setInputs: noop,
  query: '',
  setQuery: noop,
  completionParams: {
    max_tokens: 16,
    temperature: 1, // 0-2
    top_p: 1,
    presence_penalty: 1, // -2-2
    frequency_penalty: 1, // -2-2
  },
  setCompletionParams: noop,
  modelConfig: createModelConfigFixture(),
  setModelConfig: noop,
  dataSets: [],
  showSelectDataSet: noop,
  setDataSets: noop,
  datasetConfigs: createDatasetConfigsFixture(),
  datasetConfigsRef: { current: overrides.datasetConfigs ?? createDatasetConfigsFixture() },
  setDatasetConfigs: noop,
  hasSetContextVar: false,
  isShowVisionConfig: false,
  visionConfig: {
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.remote_url],
  },
  setVisionConfig: noop,
  isAllowVideoUpload: false,
  isShowDocumentConfig: false,
  isShowAudioConfig: false,
  rerankSettingModalOpen: false,
  setRerankSettingModalOpen: noop,
  ...overrides,
})

export const createPublishedConfigurationFixture = (
  overrides: Partial<ConfigurationPublishConfig> = {},
): ConfigurationPublishConfig => ({
  modelConfig: createModelConfigFixture(),
  completionParams: {},
  promptMode: PromptMode.simple,
  chatPromptConfig: structuredClone(DEFAULT_CHAT_PROMPT_CONFIG),
  completionPromptConfig: structuredClone(DEFAULT_COMPLETION_PROMPT_CONFIG),
  datasetConfigs: createDatasetConfigsFixture(),
  externalDataToolsConfig: [],
  ...overrides,
})
