import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { OnFeaturesChange } from '../types'
import { useFeatures } from '../hooks'
import OpeningStatement from './opening-statement'
import type { OpeningStatementProps } from './opening-statement'
import SuggestedQuestionsAfterAnswer from './suggested-questions-after-answer'
import TextToSpeech from './text-to-speech'
import SpeechToText from './speech-to-text'
import Citation from './citation'
import Moderation from './moderation'
import Annotation from './annotation'
import type { AnnotationProps } from './annotation'

export type FeaturePanelProps = {
  onChange?: OnFeaturesChange
  openingStatementProps: OpeningStatementProps
  annotationProps: AnnotationProps
}
const FeaturePanel = ({
  onChange,
  openingStatementProps,
  annotationProps,
}: FeaturePanelProps) => {
  const { t } = useTranslation()
  const features = useFeatures(s => s.features)

  const showAdvanceFeature = useMemo(() => {
    return features.opening.enabled || features.suggested.enabled || features.speech2text.enabled || features.text2speech.enabled || features.citation.enabled
  }, [features])

  const showToolFeature = useMemo(() => {
    return features.moderation.enabled || features.annotation.enabled
  }, [features])

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
                features.opening.enabled && (
                  <OpeningStatement {...openingStatementProps} onChange={onChange} />
                )
              }
              {
                features.suggested.enabled && (
                  <SuggestedQuestionsAfterAnswer />
                )
              }
              {
                features.text2speech.enabled && (
                  <TextToSpeech />
                )
              }
              {
                features.speech2text.enabled && (
                  <SpeechToText />
                )
              }
              {
                features.citation.enabled && (
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
                features.moderation.enabled && (
                  <Moderation onChange={onChange} />
                )
              }
              {
                features.annotation.enabled && (
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
