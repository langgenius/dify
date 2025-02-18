import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { languages } from '@/i18n/language'
import { PortalSelect } from '@/app/components/base/select'
import cn from '@/utils/classnames'

type Props = {
  currentModel: any
  language: string
  voice: string
  onChange: (language: string, voice: string) => void
}

const TTSParamsPanel = ({
  currentModel,
  language,
  voice,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const voiceList = useMemo(() => {
    if (!currentModel)
      return []
    return currentModel.model_properties.voices.map((item: { mode: any }) => ({
      ...item,
      value: item.mode,
    }))
  }, [currentModel])
  const setLanguage = (language: string) => {
    onChange(language, voice)
  }
  const setVoice = (voice: string) => {
    onChange(language, voice)
  }
  return (
    <>
      <div className='mb-3'>
        <div className='text-text-secondary system-sm-semibold mb-1 flex items-center py-1'>
          {t('appDebug.voice.voiceSettings.language')}
        </div>
        <PortalSelect
          triggerClassName='h-8'
          popupClassName={cn('z-[1000]')}
          popupInnerClassName={cn('w-[354px]')}
          value={language}
          items={languages.filter(item => item.supported)}
          onSelect={item => setLanguage(item.value as string)}
        />
      </div>
      <div className='mb-3'>
        <div className='text-text-secondary system-sm-semibold mb-1 flex items-center py-1'>
          {t('appDebug.voice.voiceSettings.voice')}
        </div>
        <PortalSelect
          triggerClassName='h-8'
          popupClassName={cn('z-[1000]')}
          popupInnerClassName={cn('w-[354px]')}
          value={voice}
          items={voiceList}
          onSelect={item => setVoice(item.value as string)}
        />
      </div>
    </>
  )
}

export default TTSParamsPanel
