'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import {
  useFeatures,
  useFeaturesStore,
} from '../hooks'
import FeatureGroup from './feature-group'
import FeatureItem from './feature-item'
import Modal from '@/app/components/base/modal'
import SuggestedQuestionsAfterAnswerIcon from '@/app/components/app/configuration/base/icons/suggested-questions-after-answer-icon'
import { Microphone01, Speaker } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { Citations } from '@/app/components/base/icons/src/vender/solid/editor'
import { FileSearch02 } from '@/app/components/base/icons/src/vender/solid/files'
import {
  MessageFast,
  MessageHeartCircle,
} from '@/app/components/base/icons/src/vender/solid/communication'
import { FeatureEnum } from '@/app/components/base/features/types'
import type { Features } from '@/app/components/base/features/types'

export type FeatureModalProps = {
  onChange?: (features: Features) => void
  showTextToSpeechItem?: boolean
  showSpeechToTextItem?: boolean
}

const FeatureModal: FC<FeatureModalProps> = ({
  onChange,
  showTextToSpeechItem,
  showSpeechToTextItem,
}) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const setShowFeaturesModal = useFeatures(s => s.setShowFeaturesModal)
  const features = useFeatures(s => s.features)

  const handleCancelModal = useCallback(() => {
    setShowFeaturesModal(false)
  }, [setShowFeaturesModal])

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft[type].enabled = enabled
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  return (
    <Modal
      isShow
      onClose={handleCancelModal}
      className='w-[400px]'
      title={t('appDebug.operation.addFeature')}
      closable
      overflowVisible
    >
      <div className='pt-5 pb-10'>
        {/* Chat Feature */}
        <FeatureGroup
          title={t('appDebug.feature.groupChat.title')}
          description={t('appDebug.feature.groupChat.description') as string}
        >
          <>
            <FeatureItem
              icon={<MessageHeartCircle className='w-4 h-4 text-[#DD2590]' />}
              previewImgClassName='openingStatementPreview'
              title={t('appDebug.feature.conversationOpener.title')}
              description={t('appDebug.feature.conversationOpener.description')}
              value={!!features.opening.enabled}
              onChange={handleChange}
              type={FeatureEnum.opening}
            />
            <FeatureItem
              icon={<SuggestedQuestionsAfterAnswerIcon />}
              previewImgClassName='suggestedQuestionsAfterAnswerPreview'
              title={t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}
              description={t('appDebug.feature.suggestedQuestionsAfterAnswer.description')}
              value={!!features.suggested.enabled}
              onChange={handleChange}
              type={FeatureEnum.suggested}
            />
            {
              showTextToSpeechItem && (
                <FeatureItem
                  icon={<Speaker className='w-4 h-4 text-[#7839EE]' />}
                  previewImgClassName='textToSpeechPreview'
                  title={t('appDebug.feature.textToSpeech.title')}
                  description={t('appDebug.feature.textToSpeech.description')}
                  value={!!features.text2speech.enabled}
                  onChange={handleChange}
                  type={FeatureEnum.text2speech}
                />
              )
            }
            {
              showSpeechToTextItem && (
                <FeatureItem
                  icon={<Microphone01 className='w-4 h-4 text-[#7839EE]' />}
                  previewImgClassName='speechToTextPreview'
                  title={t('appDebug.feature.speechToText.title')}
                  description={t('appDebug.feature.speechToText.description')}
                  value={!!features.speech2text.enabled}
                  onChange={handleChange}
                  type={FeatureEnum.speech2text}
                />
              )
            }
            <FeatureItem
              icon={<Citations className='w-4 h-4 text-[#FD853A]' />}
              previewImgClassName='citationPreview'
              title={t('appDebug.feature.citation.title')}
              description={t('appDebug.feature.citation.description')}
              value={!!features.citation.enabled}
              onChange={handleChange}
              type={FeatureEnum.citation}
            />
          </>
        </FeatureGroup>

        <FeatureGroup title={t('appDebug.feature.toolbox.title')}>
          <>
            <FeatureItem
              icon={<FileSearch02 className='w-4 h-4 text-[#039855]' />}
              previewImgClassName=''
              title={t('appDebug.feature.moderation.title')}
              description={t('appDebug.feature.moderation.description')}
              value={!!features.moderation.enabled}
              onChange={handleChange}
              type={FeatureEnum.moderation}
            />
            <FeatureItem
              icon={<MessageFast className='w-4 h-4 text-[#444CE7]' />}
              title={t('appDebug.feature.annotation.title')}
              description={t('appDebug.feature.annotation.description')}
              value={!!features.annotation.enabled}
              onChange={handleChange}
              type={FeatureEnum.annotation}
            />
          </>
        </FeatureGroup>
      </div>
    </Modal>
  )
}
export default React.memo(FeatureModal)
