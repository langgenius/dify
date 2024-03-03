'use client'
import useSWR from 'swr'
import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { usePathname } from 'next/navigation'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { Speaker } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import ConfigContext from '@/context/debug-configuration'
import { languages } from '@/i18n/language'
import { fetchAppVoices } from '@/service/apps'
import AudioBtn from '@/app/components/base/audio-btn'

const TextToSpeech: FC = () => {
  const { t } = useTranslation()
  const {
    textToSpeechConfig,
  } = useContext(ConfigContext)

  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const language = textToSpeechConfig.language
  const languageInfo = languages.find(i => i.value === textToSpeechConfig.language)

  const voiceItems = useSWR({ appId, language }, fetchAppVoices).data
  const voiceItem = voiceItems?.find(item => item.value === textToSpeechConfig.voice)

  return (
    <Panel
      title={
        <div className='flex items-center'>
          <div>{t('appDebug.feature.textToSpeech.title')}</div>
        </div>
      }
      headerIcon={<Speaker className='w-4 h-4 text-[#7839EE]' />}
      headerRight={
        <div className='text-xs text-gray-500 inline-flex items-center gap-2'>
          {languageInfo && (`${languageInfo?.name} - `)}{voiceItem?.name ?? t('appDebug.voice.defaultDisplay')}
          { languageInfo?.example && (
            <AudioBtn
              value={languageInfo?.example}
              voice={voiceItem?.value}
              isAudition={true}
            />
          )}
        </div>
      }
      noBodySpacing
      isShowTextToSpeech={true}
    />
  )
}
export default React.memo(TextToSpeech)
