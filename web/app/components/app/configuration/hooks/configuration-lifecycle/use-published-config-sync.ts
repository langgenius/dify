import type { ConfigurationPublishConfig } from './types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ExternalDataTool } from '@/models/common'
import type { DataSet } from '@/models/datasets'
import type {
  DatasetConfigs,
  ModelConfig,
  ModerationConfig,
  MoreLikeThisConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { VisionSettings } from '@/types/app'
import { useCallback } from 'react'
import { PromptMode } from '@/models/debug'
import { Resolution, TransferMethod } from '@/types/app'

type UsePublishedConfigSyncParams = {
  setCanReturnToSimpleMode: (value: boolean) => void
  setChatPromptConfig: (value: ConfigurationPublishConfig['chatPromptConfig']) => void
  setCitationConfig: (value: MoreLikeThisConfig) => void
  setCompletionParams: (value: FormValue) => void
  setCompletionPromptConfig: (value: ConfigurationPublishConfig['completionPromptConfig']) => void
  setDataSets: (value: DataSet[]) => void
  setDatasetConfigs: (value: DatasetConfigs) => void
  setExternalDataToolsConfig: (value: ExternalDataTool[]) => void
  setIntroduction: (value: string) => void
  setModelConfig: (value: ModelConfig) => void
  setModerationConfig: (value: ModerationConfig) => void
  setMoreLikeThisConfig: (value: MoreLikeThisConfig) => void
  setPromptModeState: (value: PromptMode) => void
  setSpeechToTextConfig: (value: MoreLikeThisConfig) => void
  setSuggestedQuestions: (value: string[]) => void
  setSuggestedQuestionsAfterAnswerConfig: (value: MoreLikeThisConfig) => void
  setTextToSpeechConfig: (value: TextToSpeechConfig) => void
  setVisionConfig: (value: VisionSettings, notNoticeFormattingChanged?: boolean) => void
}

export function usePublishedConfigSync({
  setCanReturnToSimpleMode,
  setChatPromptConfig,
  setCitationConfig,
  setCompletionParams,
  setCompletionPromptConfig,
  setDataSets,
  setDatasetConfigs,
  setExternalDataToolsConfig,
  setIntroduction,
  setModelConfig,
  setModerationConfig,
  setMoreLikeThisConfig,
  setPromptModeState,
  setSpeechToTextConfig,
  setSuggestedQuestions,
  setSuggestedQuestionsAfterAnswerConfig,
  setTextToSpeechConfig,
  setVisionConfig,
}: UsePublishedConfigSyncParams) {
  return useCallback(
    (publishedConfig: ConfigurationPublishConfig) => {
      const publishedModelConfig = publishedConfig.modelConfig
      setModelConfig(publishedModelConfig)
      setCompletionParams(publishedConfig.completionParams)
      setPromptModeState(publishedConfig.promptMode)
      setCanReturnToSimpleMode(publishedConfig.promptMode !== PromptMode.advanced)
      setChatPromptConfig(publishedConfig.chatPromptConfig)
      setCompletionPromptConfig(publishedConfig.completionPromptConfig)
      setDataSets(publishedModelConfig.dataSets || [])
      setDatasetConfigs(publishedConfig.datasetConfigs)
      setExternalDataToolsConfig(publishedConfig.externalDataToolsConfig)
      setIntroduction(publishedModelConfig.opening_statement || '')
      setSuggestedQuestions(publishedModelConfig.suggested_questions || [])
      setMoreLikeThisConfig(publishedModelConfig.more_like_this || { enabled: false })
      setSuggestedQuestionsAfterAnswerConfig(
        publishedModelConfig.suggested_questions_after_answer || { enabled: false },
      )
      setSpeechToTextConfig(publishedModelConfig.speech_to_text || { enabled: false })
      setTextToSpeechConfig(
        publishedModelConfig.text_to_speech || {
          enabled: false,
          voice: '',
          language: '',
        },
      )
      setCitationConfig(publishedModelConfig.retriever_resource || { enabled: false })
      setModerationConfig(publishedModelConfig.sensitive_word_avoidance || { enabled: false })
      const publishedVisionConfig = publishedModelConfig.file_upload?.image
      setVisionConfig(
        {
          enabled: publishedVisionConfig?.enabled || false,
          number_limits: publishedVisionConfig?.number_limits || 2,
          detail: publishedVisionConfig?.detail || Resolution.low,
          transfer_methods: publishedVisionConfig?.transfer_methods || [TransferMethod.local_file],
        },
        true,
      )
    },
    [
      setCanReturnToSimpleMode,
      setChatPromptConfig,
      setCitationConfig,
      setCompletionParams,
      setCompletionPromptConfig,
      setDataSets,
      setDatasetConfigs,
      setExternalDataToolsConfig,
      setIntroduction,
      setModelConfig,
      setModerationConfig,
      setMoreLikeThisConfig,
      setPromptModeState,
      setSpeechToTextConfig,
      setSuggestedQuestions,
      setSuggestedQuestionsAfterAnswerConfig,
      setTextToSpeechConfig,
      setVisionConfig,
    ],
  )
}
