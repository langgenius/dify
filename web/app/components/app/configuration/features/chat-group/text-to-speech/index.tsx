'use client'
import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { Speaker } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import ConfigContext from '@/context/debug-configuration'
import { languages } from '@/utils/language'

const TextToSpeech: FC = () => {
  const { t } = useTranslation()
  const {
    textToSpeechConfig,
  } = useContext(ConfigContext)
  return (
    <Panel
      title={
        <div className='flex items-center gap-2'>
          <div>{t('appDebug.feature.textToSpeech.title')}</div>
        </div>
      }
      headerIcon={<Speaker className='w-4 h-4 text-[#7839EE]' />}
      headerRight={
        <div className='text-xs text-gray-500'>
          {languages.find(i => i.value === textToSpeechConfig.language)?.name} {textToSpeechConfig.voice}
        </div>
      }
      noBodySpacing
      isShowTextToSpeech={true}
    />
  )
}
export default React.memo(TextToSpeech)
