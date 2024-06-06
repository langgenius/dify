'use client'
import useSWR from 'swr'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname } from 'next/navigation'
import { useFeatures } from '../../hooks'
import type { OnFeaturesChange } from '../../types'
import ParamsConfig from './params-config'
import { Speaker } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { languages } from '@/i18n/language'
import { fetchAppVoices } from '@/service/apps'
import AudioBtn from '@/app/components/base/audio-btn'

type TextToSpeechProps = {
  onChange?: OnFeaturesChange
  disabled?: boolean
}
const TextToSpeech = ({
  onChange,
  disabled,
}: TextToSpeechProps) => {
  const { t } = useTranslation()
  const textToSpeech = useFeatures(s => s.features.text2speech)

  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const language = textToSpeech?.language
  const languageInfo = languages.find(i => i.value === textToSpeech?.language)

  const voiceItems = useSWR({ appId, language }, fetchAppVoices).data
  const voiceItem = voiceItems?.find(item => item.value === textToSpeech?.voice)

  return (
    <div className='flex items-center px-3 h-12 bg-gray-50 rounded-xl overflow-hidden'>
      <div className='shrink-0 flex items-center justify-center mr-1 w-6 h-6'>
        <Speaker className='w-4 h-4 text-[#7839EE]' />
      </div>
      <div className='shrink-0 mr-2 whitespace-nowrap text-sm text-gray-800 font-semibold'>
        {t('appDebug.feature.textToSpeech.title')}
      </div>
      <div
        className='grow '>
      </div>
      <div className='shrink-0 text-xs text-gray-500 inline-flex items-center gap-2'>
        {languageInfo && (`${languageInfo?.name} - `)}{voiceItem?.name ?? t('appDebug.voice.defaultDisplay')}
        { languageInfo?.example && (
          <AudioBtn
            value={languageInfo?.example}
            voice={voiceItem?.value}
            noCache={false}
            isAudition={true}
          />
        )}
      </div>
      <div className='shrink-0 flex items-center'>
        <ParamsConfig onChange={onChange} disabled={disabled} />
      </div>
    </div>
  )
}
export default React.memo(TextToSpeech)
