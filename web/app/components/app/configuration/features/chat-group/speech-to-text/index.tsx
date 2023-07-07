'use client'
import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { Microphone01 } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'

const SuggestedQuestionsAfterAnswer: FC = () => {
  const { t } = useTranslation()

  return (
    <Panel
      title={
        <div className='flex items-center gap-2'>
          <div>{t('appDebug.feature.speechToText.title')}</div>
        </div>
      }
      headerIcon={<Microphone01 className='w-4 h-4 text-[#7839EE]' />}
      headerRight={
        <div className='text-xs text-gray-500'>{t('appDebug.feature.speechToText.resDes')}</div>
      }
      noBodySpacing
    />
  )
}
export default React.memo(SuggestedQuestionsAfterAnswer)
