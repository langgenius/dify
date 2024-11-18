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
  PromptMode,
  SpeechToTextConfig,
  SuggestedQuestionsAfterAnswerConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { ExternalDataTool } from '@/models/common'
import type { DataSet } from '@/models/datasets'
import type { ModelModeType, VisionSettings } from '@/types/app'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Collection } from '@/app/components/tools/types'
import { createSelectorCtx } from '@/utils/context'

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
  setDatasetConfigs: (config: DatasetConfigs) => void
  hasSetContextVar: boolean
  isShowVisionConfig: boolean
  visionConfig: VisionSettings
  setVisionConfig: (visionConfig: VisionSettings, noNotice?: boolean) => void
  rerankSettingModalOpen: boolean
  setRerankSettingModalOpen: (rerankSettingModalOpen: boolean) => void
}

const [, useDebugConfigurationContext, DebugConfigurationContext] = createSelectorCtx<IDebugConfiguration>()

export { useDebugConfigurationContext }

export default DebugConfigurationContext
