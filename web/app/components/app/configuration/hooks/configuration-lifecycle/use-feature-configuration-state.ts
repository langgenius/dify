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

function useTrackedState<Value>(initialValue: Value, onChange: () => void) {
  const [value, setValue] = useState(initialValue)
  const updateValue = useCallback(
    (nextValue: Value) => {
      setValue(nextValue)
      onChange()
    },
    [onChange],
  )
  return [value, updateValue] as const
}

export function useFeatureConfigurationState(dispatchPublishDraftChanged: () => void) {
  const [introduction, setIntroduction] = useTrackedState('', dispatchPublishDraftChanged)
  const [suggestedQuestions, setSuggestedQuestions] = useTrackedState<string[]>(
    [],
    dispatchPublishDraftChanged,
  )
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useTrackedState<MoreLikeThisConfig>(
    { enabled: false },
    dispatchPublishDraftChanged,
  )
  const [suggestedQuestionsAfterAnswerConfig, setSuggestedQuestionsAfterAnswerConfig] =
    useTrackedState<MoreLikeThisConfig>({ enabled: false }, dispatchPublishDraftChanged)
  const [speechToTextConfig, setSpeechToTextConfig] = useTrackedState<MoreLikeThisConfig>(
    { enabled: false },
    dispatchPublishDraftChanged,
  )
  const [textToSpeechConfig, setTextToSpeechConfig] = useTrackedState<TextToSpeechConfig>(
    { enabled: false, voice: '', language: '' },
    dispatchPublishDraftChanged,
  )
  const [citationConfig, setCitationConfig] = useTrackedState<MoreLikeThisConfig>(
    { enabled: false },
    dispatchPublishDraftChanged,
  )
  const [moderationConfig, setModerationConfig] = useTrackedState<ModerationConfig>(
    { enabled: false },
    dispatchPublishDraftChanged,
  )
  const [externalDataToolsConfig, setExternalDataToolsConfig] = useTrackedState<ExternalDataTool[]>(
    [],
    dispatchPublishDraftChanged,
  )
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
