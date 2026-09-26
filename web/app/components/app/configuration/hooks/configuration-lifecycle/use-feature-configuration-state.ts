import type { ConfigurationPublishConfig } from './types'
import type { ExternalDataTool } from '@/models/common'
import type {
  AnnotationReplyConfig,
  ModerationConfig,
  MoreLikeThisConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import { useCallback, useState } from 'react'
import { useFormattingChangedDispatcher } from '@/app/components/app/configuration/debug/hooks'
import { ANNOTATION_DEFAULT } from '@/config'

export function useFeatureConfigurationState(initialConfig: ConfigurationPublishConfig) {
  const initialModelConfig = initialConfig.modelConfig
  const [introduction, setIntroduction] = useState(initialModelConfig.opening_statement ?? '')
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(
    initialModelConfig.suggested_questions ?? [],
  )
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig>(
    initialModelConfig.more_like_this ?? {
      enabled: false,
    },
  )
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] =
    useState<MoreLikeThisConfig>(
      initialModelConfig.suggested_questions_after_answer ?? { enabled: false },
    )
  const [speechToTextConfig, setSpeechToTextConfig] = useState<MoreLikeThisConfig>(
    initialModelConfig.speech_to_text ?? {
      enabled: false,
    },
  )
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig>(
    initialModelConfig.text_to_speech ?? {
      enabled: false,
      voice: '',
      language: '',
    },
  )
  const [citationConfig, setCitationConfig] = useState<MoreLikeThisConfig>(
    initialModelConfig.retriever_resource ?? { enabled: false },
  )
  const [moderationConfig, setModerationConfig] = useState<ModerationConfig>(
    initialModelConfig.sensitive_word_avoidance ?? { enabled: false },
  )
  const [externalDataToolsConfig, setExternalDataToolsConfig] = useState<ExternalDataTool[]>(
    initialConfig.externalDataToolsConfig,
  )
  const [annotationConfig, setAnnotationConfig] = useState<AnnotationReplyConfig>(
    initialModelConfig.annotation_reply ?? {
      id: '',
      enabled: false,
      score_threshold: ANNOTATION_DEFAULT.score_threshold,
      embedding_model: { embedding_provider_name: '', embedding_model_name: '' },
    },
  )
  const formattingChangedDispatcher = useFormattingChangedDispatcher()
  const updateAnnotationConfig = useCallback(
    (config: AnnotationReplyConfig, notSetFormatChanged?: boolean) => {
      setAnnotationConfig(config)
      if (!notSetFormatChanged) formattingChangedDispatcher()
    },
    [formattingChangedDispatcher],
  )

  return {
    annotationConfig,
    citationConfig,
    externalDataToolsConfig,
    formattingChangedDispatcher,
    introduction,
    moderationConfig,
    moreLikeThisConfig,
    setAnnotationConfig: updateAnnotationConfig,
    setCitationConfig,
    setExternalDataToolsConfig,
    setIntroduction,
    setModerationConfig,
    setMoreLikeThisConfig,
    setSpeechToTextConfig,
    setSuggestedQuestions,
    setSuggestedQuestionsAfterAnswerConfig,
    setTextToSpeechConfig,
    speechToTextConfig,
    suggestedQuestions,
    suggestedQuestionsAfterAnswerConfig,
    textToSpeechConfig,
  }
}
