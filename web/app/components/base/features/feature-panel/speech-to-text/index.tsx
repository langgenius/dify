'use client'
import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnFeaturesChange } from '../../types'
import ParamsConfig from './params-config'
import { Microphone01 } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
type SpeechtotextProps = {
  onChange?: OnFeaturesChange
  disabled?: boolean
}

const SpeechToTextConfig: FC<SpeechtotextProps> = ({ onChange, disabled }) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center px-3 h-12 bg-gray-50 rounded-xl overflow-hidden'>
      <div className='shrink-0 flex items-center justify-center mr-1 w-6 h-6'>
        <Microphone01 className='w-4 h-4 text-[#7839EE]' />
      </div>
      <div className='shrink-0 mr-2 whitespace-nowrap text-sm text-gray-800 font-semibold'>
        <div>{t('appDebug.feature.speechToText.title')}</div>
      </div>
      <div className='grow'></div>
      <div className='shrink-0 text-xs text-gray-500 inline-flex items-center gap-2'>{t('appDebug.feature.speechToText.resDes')}</div>
      <div className='shrink-0 flex items-center ml-2'>
        <ParamsConfig onChange={onChange} disabled={disabled} />
      </div>
    </div>
  )
}
export default React.memo(SpeechToTextConfig)
