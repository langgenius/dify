'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../../base/group-name'
import TextToSpeech from '../chat-group/text-to-speech'
import MoreLikeThis from './more-like-this'

/*
* Include
* 1. More like this
*/

type ExperienceGroupProps = {
  isShowTextToSpeech: boolean
  isShowMoreLike: boolean
}

const ExperienceEnhanceGroup: FC<ExperienceGroupProps> = ({
  isShowTextToSpeech,
  isShowMoreLike,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.groupExperience.title')}/>
      <div className='space-y-3'>
        {
          isShowMoreLike && (
            <MoreLikeThis/>
          )
        }
        {
          isShowTextToSpeech && (
            <TextToSpeech/>
          )
        }
      </div>
    </div>
  )
}
export default React.memo(ExperienceEnhanceGroup)
