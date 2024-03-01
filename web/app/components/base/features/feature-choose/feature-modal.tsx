'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { useFeatures } from '../hooks'
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

export type ChooseFeatureProps = {
  showTextToSpeechItem?: boolean
  showSpeechToTextItem?: boolean
}

const ChooseFeature: FC<ChooseFeatureProps> = ({
  showTextToSpeechItem,
  showSpeechToTextItem,
}) => {
  const { t } = useTranslation()
  const setShowFeaturesModal = useFeatures(s => s.setShowFeaturesModal)
  const openingStatement = useFeatures(s => s.openingStatement)
  const setOpeningStatement = useFeatures(s => s.setOpeningStatement)
  const suggestedQuestionsAfterAnswer = useFeatures(s => s.suggestedQuestionsAfterAnswer)
  const setSuggestedQuestionsAfterAnswer = useFeatures(s => s.setSuggestedQuestionsAfterAnswer)
  const textToSpeech = useFeatures(s => s.textToSpeech)
  const setTextToSpeech = useFeatures(s => s.setTextToSpeech)
  const speechToText = useFeatures(s => s.speechToText)
  const setSpeechToText = useFeatures(s => s.setSpeechToText)
  const citation = useFeatures(s => s.citation)
  const setCitation = useFeatures(s => s.setCitation)
  const moderation = useFeatures(s => s.moderation)
  const setModeration = useFeatures(s => s.setModeration)
  const annotation = useFeatures(s => s.annotation)
  const setAnnotation = useFeatures(s => s.setAnnotation)

  const handleCancelModal = useCallback(() => {
    setShowFeaturesModal(false)
  }, [setShowFeaturesModal])

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
              value={openingStatement.enabled}
              onChange={value => setOpeningStatement(produce(openingStatement, (draft) => {
                draft.enabled = value
              }))}
            />
            <FeatureItem
              icon={<SuggestedQuestionsAfterAnswerIcon />}
              previewImgClassName='suggestedQuestionsAfterAnswerPreview'
              title={t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}
              description={t('appDebug.feature.suggestedQuestionsAfterAnswer.description')}
              value={suggestedQuestionsAfterAnswer.enabled}
              onChange={value => setSuggestedQuestionsAfterAnswer(produce(suggestedQuestionsAfterAnswer, (draft) => {
                draft.enabled = value
              }))}
            />
            {
              showTextToSpeechItem && (
                <FeatureItem
                  icon={<Speaker className='w-4 h-4 text-[#7839EE]' />}
                  previewImgClassName='textToSpeechPreview'
                  title={t('appDebug.feature.textToSpeech.title')}
                  description={t('appDebug.feature.textToSpeech.description')}
                  value={textToSpeech.enabled}
                  onChange={value => setTextToSpeech(produce(textToSpeech, (draft) => {
                    draft.enabled = value
                  }))}
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
                  value={speechToText.enabled}
                  onChange={value => setSpeechToText(produce(speechToText, (draft) => {
                    draft.enabled = value
                  }))}
                />
              )
            }
            <FeatureItem
              icon={<Citations className='w-4 h-4 text-[#FD853A]' />}
              previewImgClassName='citationPreview'
              title={t('appDebug.feature.citation.title')}
              description={t('appDebug.feature.citation.description')}
              value={citation.enabled}
              onChange={value => setCitation(produce(citation, (draft) => {
                draft.enabled = value
              }))}
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
              value={moderation.enabled}
              onChange={value => setModeration(produce(moderation, (draft) => {
                draft.enabled = value
              }))}
            />
            <FeatureItem
              icon={<MessageFast className='w-4 h-4 text-[#444CE7]' />}
              title={t('appDebug.feature.annotation.title')}
              description={t('appDebug.feature.annotation.description')}
              value={annotation.enabled}
              onChange={value => setAnnotation(produce(annotation, (draft) => {
                draft.enabled = value
              }))}
            />
          </>
        </FeatureGroup>
      </div>
    </Modal>
  )
}
export default React.memo(ChooseFeature)
