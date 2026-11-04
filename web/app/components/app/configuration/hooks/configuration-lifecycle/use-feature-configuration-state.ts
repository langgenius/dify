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

export function useFeatureConfigurationState() {
  const [introduction, setIntroduction] = useState('')
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] =
    useState<MoreLikeThisConfig>({ enabled: false })
  const [speechToTextConfig, setSpeechToTextConfig] = useState<MoreLikeThisConfig>({
    enabled: false,
  })
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig>({
    enabled: false,
    voice: '',
    language: '',
  })
  const [citationConfig, setCitationConfig] = useState<MoreLikeThisConfig>({ enabled: false })
  const [moderationConfig, setModerationConfig] = useState<ModerationConfig>({ enabled: false })
  const [externalDataToolsConfig, setExternalDataToolsConfig] = useState<ExternalDataTool[]>([])
  const [annotationConfig, setAnnotationConfig] = useState<AnnotationReplyConfig>({
    id: '',
    enabled: false,
    score_threshold: ANNOTATION_DEFAULT.score_threshold,
    embedding_model: {
      embedding_provider_name: '',
      embedding_model_name: '',
    },
  })
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
