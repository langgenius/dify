import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures } from '../hooks'
import OpeningStatement from './opening-statement'
import type { OpeningStatementProps } from './opening-statement'
import SuggestedQuestionsAfterAnswer from './suggested-questions-after-answer'
import TextToSpeech from './text-to-speech'
import SpeechToText from './speech-to-text'
import Citation from './citation'
import Moderation from './moderation'
import Annotation from './annotation/config-param'
import type { AnnotationProps } from './annotation/config-param'

export type FeaturePanelProps = {
  openingStatementProps: OpeningStatementProps
  annotationProps: AnnotationProps
}
const FeaturePanel = ({
  openingStatementProps,
  annotationProps,
}: FeaturePanelProps) => {
  const { t } = useTranslation()
  const openingStatement = useFeatures(s => s.openingStatement)
  const suggestedQuestionsAfterAnswer = useFeatures(s => s.suggestedQuestionsAfterAnswer)
  const textToSpeech = useFeatures(s => s.textToSpeech)
  const speechToText = useFeatures(s => s.speechToText)
  const citation = useFeatures(s => s.citation)
  const moderation = useFeatures(s => s.moderation)
  const annotation = useFeatures(s => s.annotation)

  const showAdvanceFeature = useMemo(() => {
    return openingStatement.enabled || suggestedQuestionsAfterAnswer.enabled || textToSpeech.enabled || speechToText.enabled || citation.enabled
  }, [openingStatement, suggestedQuestionsAfterAnswer, textToSpeech, speechToText, citation])

  const showToolFeature = useMemo(() => {
    return moderation.enabled || annotation.enabled
  }, [moderation, annotation])

  return (
    <div className='space-y-3'>
      {
        showAdvanceFeature && (
          <div>
            <div className='flex items-center'>
              <div className='shrink-0 text-xs font-semibold text-gray-500'>
                {t('appDebug.feature.groupChat.title')}
              </div>
              <div
                className='grow ml-3 h-[1px]'
                style={{ background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, #F3F4F6 100%)' }}
              ></div>
            </div>
            <div className='py-2 space-y-2'>
              {
                openingStatement.enabled && (
                  <OpeningStatement {...openingStatementProps} />
                )
              }
              {
                suggestedQuestionsAfterAnswer.enabled && (
                  <SuggestedQuestionsAfterAnswer />
                )
              }
              {
                textToSpeech.enabled && (
                  <TextToSpeech />
                )
              }
              {
                speechToText.enabled && (
                  <SpeechToText />
                )
              }
              {
                citation.enabled && (
                  <Citation />
                )
              }
            </div>
          </div>
        )
      }
      {
        showToolFeature && (
          <div>
            <div className='flex items-center'>
              <div className='shrink-0 text-xs font-semibold text-gray-500'>
                {t('appDebug.feature.groupChat.title')}
              </div>
              <div
                className='grow ml-3 h-[1px]'
                style={{ background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, #F3F4F6 100%)' }}
              ></div>
            </div>
            <div className='py-2 space-y-2'>
              {
                moderation.enabled && (
                  <Moderation />
                )
              }
              {
                annotation.enabled && (
                  <Annotation {...annotationProps} />
                )
              }
            </div>
          </div>
        )
      }
    </div>
  )
}
export default memo(FeaturePanel)
