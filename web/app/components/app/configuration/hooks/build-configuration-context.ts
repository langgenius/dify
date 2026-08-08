import type { useDatasetConfigurationState } from './configuration-lifecycle/use-dataset-configuration-state'
import type { useFeatureConfigurationState } from './configuration-lifecycle/use-feature-configuration-state'
import type { useModelConfigurationState } from './configuration-lifecycle/use-model-configuration-state'
import type { DebugConfigurationValue } from './configuration-view-model'
import type useAdvancedPromptConfig from './use-advanced-prompt-config'

type AdvancedPromptConfiguration = ReturnType<typeof useAdvancedPromptConfig>
type DatasetConfiguration = ReturnType<typeof useDatasetConfigurationState>
type FeatureConfiguration = ReturnType<typeof useFeatureConfigurationState>
type ModelConfiguration = ReturnType<typeof useModelConfigurationState>

type ContextBase = Pick<
  DebugConfigurationValue,
  | 'appId'
  | 'canReturnToSimpleMode'
  | 'canTestAndRun'
  | 'collectionList'
  | 'controlClearChatMessage'
  | 'conversationId'
  | 'formattingChanged'
  | 'hasSetContextVar'
  | 'inputs'
  | 'isAdvancedMode'
  | 'isAgent'
  | 'isAllowVideoUpload'
  | 'isFunctionCall'
  | 'isOpenAI'
  | 'isShowAudioConfig'
  | 'isShowDocumentConfig'
  | 'isShowVisionConfig'
  | 'isTrailFinished'
  | 'isAPIKeySet'
  | 'mode'
  | 'modelModeType'
  | 'prevPromptConfig'
  | 'promptMode'
  | 'query'
  | 'readonly'
  | 'rerankSettingModalOpen'
  | 'setCanReturnToSimpleMode'
  | 'setControlClearChatMessage'
  | 'setConversationId'
  | 'setFormattingChanged'
  | 'setInputs'
  | 'setPrevPromptConfig'
  | 'setPromptMode'
  | 'setQuery'
  | 'setRerankSettingModalOpen'
  | 'showHistoryModal'
  | 'showSelectDataSet'
>

export function buildConfigurationContextValue({
  advancedPrompt,
  base,
  dataset,
  feature,
  model,
}: {
  advancedPrompt: AdvancedPromptConfiguration
  base: ContextBase
  dataset: DatasetConfiguration
  feature: FeatureConfiguration
  model: ModelConfiguration
}): DebugConfigurationValue {
  return {
    ...base,
    annotationConfig: feature.annotationConfig,
    chatPromptConfig: advancedPrompt.chatPromptConfig,
    citationConfig: feature.citationConfig,
    completionParams: model.completionParams,
    completionPromptConfig: advancedPrompt.completionPromptConfig,
    conversationHistoriesRole: advancedPrompt.completionPromptConfig.conversation_histories_role,
    currentAdvancedPrompt: advancedPrompt.currentAdvancedPrompt,
    dataSets: dataset.dataSets,
    datasetConfigs: dataset.datasetConfigs,
    datasetConfigsRef: dataset.datasetConfigsRef,
    externalDataToolsConfig: feature.externalDataToolsConfig,
    hasSetBlockStatus: advancedPrompt.hasSetBlockStatus,
    introduction: feature.introduction,
    modelConfig: model.modelConfig,
    moderationConfig: feature.moderationConfig,
    moreLikeThisConfig: feature.moreLikeThisConfig,
    setAnnotationConfig: feature.setAnnotationConfig,
    setCitationConfig: feature.setCitationConfig,
    setCompletionParams: model.setCompletionParams,
    setConversationHistoriesRole: advancedPrompt.setConversationHistoriesRole,
    setCurrentAdvancedPrompt: advancedPrompt.setCurrentAdvancedPrompt,
    setDataSets: dataset.setDataSets,
    setDatasetConfigs: dataset.setDatasetConfigs,
    setExternalDataToolsConfig: feature.setExternalDataToolsConfig,
    setIntroduction: feature.setIntroduction,
    setModelConfig: model.setModelConfig,
    setModerationConfig: feature.setModerationConfig,
    setMoreLikeThisConfig: feature.setMoreLikeThisConfig,
    setSpeechToTextConfig: feature.setSpeechToTextConfig,
    setSuggestedQuestions: feature.setSuggestedQuestions,
    setSuggestedQuestionsAfterAnswerConfig: feature.setSuggestedQuestionsAfterAnswerConfig,
    setTextToSpeechConfig: feature.setTextToSpeechConfig,
    setVisionConfig: model.setVisionConfig,
    speechToTextConfig: feature.speechToTextConfig,
    suggestedQuestions: feature.suggestedQuestions,
    suggestedQuestionsAfterAnswerConfig: feature.suggestedQuestionsAfterAnswerConfig,
    textToSpeechConfig: feature.textToSpeechConfig,
    visionConfig: model.visionConfig,
  }
}
