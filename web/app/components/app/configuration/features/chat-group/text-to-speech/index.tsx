'use client'
import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { Speaker } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'

const TextToSpeech: FC = () => {
  const { t } = useTranslation()

  return (
    <Panel
      title={
        <div className='flex items-center gap-2'>
          <div>{t('appDebug.feature.textToSpeech.title')}</div>
        </div>
      }
      headerIcon={<Speaker className='w-4 h-4 text-[#7839EE]' />}
      headerRight={
        <div className='text-xs text-gray-500'>{t('appDebug.feature.textToSpeech.resDes')}</div>
      }
      noBodySpacing
      isShowTextToSpeech={true}
    />
  )
}
export default React.memo(TextToSpeech)
