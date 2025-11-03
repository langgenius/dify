import type { RefObject } from 'react'
import { createContext, useContext } from 'use-context-selector'
import { PromptMode } from '@/models/debug'
import type {
  AnnotationReplyConfig,
  BlockStatus,
  ChatPromptConfig,
  CitationConfig,
  CompletionPromptConfig,
  ConversationHistoriesRole,
  DatasetConfigs,
  Inputs,
  ModelConfig,
  ModerationConfig,
  MoreLikeThisConfig,
  PromptConfig,
  PromptItem,
  SpeechToTextConfig,
  SuggestedQuestionsAfterAnswerConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { ExternalDataTool } from '@/models/common'
import type { DataSet } from '@/models/datasets'
import type { VisionSettings } from '@/types/app'
import { ModelModeType, RETRIEVE_TYPE, Resolution, TransferMethod } from '@/types/app'
import { ANNOTATION_DEFAULT, DEFAULT_AGENT_SETTING, DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Collection } from '@/app/components/tools/types'
import { noop } from 'lodash-es'

type IDebugConfiguration = {
  appId: string
  isAPIKeySet: boolean
  isTrailFinished: boolean
  mode: string
  modelModeType: ModelModeType
  promptMode: PromptMode
  setPromptMode: (promptMode: PromptMode) => void
  isAdvancedMode: boolean
  isAgent: boolean
  isFunctionCall: boolean
  isOpenAI: boolean
  collectionList: Collection[]
  canReturnToSimpleMode: boolean
  setCanReturnToSimpleMode: (canReturnToSimpleMode: boolean) => void
  chatPromptConfig: ChatPromptConfig
  completionPromptConfig: CompletionPromptConfig
  currentAdvancedPrompt: PromptItem | PromptItem[]
  setCurrentAdvancedPrompt: (prompt: PromptItem | PromptItem[], isUserChanged?: boolean) => void
  showHistoryModal: () => void
  conversationHistoriesRole: ConversationHistoriesRole
  setConversationHistoriesRole: (conversationHistoriesRole: ConversationHistoriesRole) => void
  hasSetBlockStatus: BlockStatus
  conversationId: string | null // after first chat send
  setConversationId: (conversationId: string | null) => void
  introduction: string
  setIntroduction: (introduction: string) => void
  suggestedQuestions: string[]
  setSuggestedQuestions: (questions: string[]) => void
  controlClearChatMessage: number
  setControlClearChatMessage: (controlClearChatMessage: number) => void
  prevPromptConfig: PromptConfig
  setPrevPromptConfig: (prevPromptConfig: PromptConfig) => void
  moreLikeThisConfig: MoreLikeThisConfig
  setMoreLikeThisConfig: (moreLikeThisConfig: MoreLikeThisConfig) => void
  suggestedQuestionsAfterAnswerConfig: SuggestedQuestionsAfterAnswerConfig
  setSuggestedQuestionsAfterAnswerConfig: (suggestedQuestionsAfterAnswerConfig: SuggestedQuestionsAfterAnswerConfig) => void
  speechToTextConfig: SpeechToTextConfig
  setSpeechToTextConfig: (speechToTextConfig: SpeechToTextConfig) => void
  textToSpeechConfig: TextToSpeechConfig
  setTextToSpeechConfig: (textToSpeechConfig: TextToSpeechConfig) => void
  citationConfig: CitationConfig
  setCitationConfig: (citationConfig: CitationConfig) => void
  annotationConfig: AnnotationReplyConfig
  setAnnotationConfig: (annotationConfig: AnnotationReplyConfig) => void
  moderationConfig: ModerationConfig
  setModerationConfig: (moderationConfig: ModerationConfig) => void
  externalDataToolsConfig: ExternalDataTool[]
  setExternalDataToolsConfig: (externalDataTools: ExternalDataTool[]) => void
  formattingChanged: boolean
  setFormattingChanged: (formattingChanged: boolean) => void
  inputs: Inputs
  setInputs: (inputs: Inputs) => void
  query: string // user question
  setQuery: (query: string) => void
  // Belows are draft infos
  completionParams: FormValue
  setCompletionParams: (completionParams: FormValue) => void
  // model_config
  modelConfig: ModelConfig
  setModelConfig: (modelConfig: ModelConfig) => void
  dataSets: DataSet[]
  setDataSets: (dataSet: DataSet[]) => void
  showSelectDataSet: () => void
  // dataset config
  datasetConfigs: DatasetConfigs
  datasetConfigsRef: RefObject<DatasetConfigs>
  setDatasetConfigs: (config: DatasetConfigs) => void
  hasSetContextVar: boolean
  isShowVisionConfig: boolean
  visionConfig: VisionSettings
  setVisionConfig: (visionConfig: VisionSettings, noNotice?: boolean) => void
  isAllowVideoUpload: boolean
  isShowDocumentConfig: boolean
  isShowAudioConfig: boolean
  rerankSettingModalOpen: boolean
  setRerankSettingModalOpen: (rerankSettingModalOpen: boolean) => void
}

const DebugConfigurationContext = createContext<IDebugConfiguration>({
  appId: '',
  isAPIKeySet: false,
  isTrailFinished: false,
  mode: '',
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
  chatPromptConfig: DEFAULT_CHAT_PROMPT_CONFIG,
  completionPromptConfig: DEFAULT_COMPLETION_PROMPT_CONFIG,
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
  modelConfig: {
    provider: 'OPENAI', // 'OPENAI'
    model_id: 'gpt-3.5-turbo', // 'gpt-3.5-turbo'
    mode: ModelModeType.unset,
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
    chat_prompt_config: DEFAULT_CHAT_PROMPT_CONFIG,
    completion_prompt_config: DEFAULT_COMPLETION_PROMPT_CONFIG,
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
    agentConfig: DEFAULT_AGENT_SETTING,
  },
  setModelConfig: noop,
  dataSets: [],
  showSelectDataSet: noop,
  setDataSets: noop,
  datasetConfigs: {
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
  },
  datasetConfigsRef: {
    current: null,
  } as unknown as RefObject<DatasetConfigs>,
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
})

export const useDebugConfigurationContext = () => useContext(DebugConfigurationContext)

export default DebugConfigurationContext
