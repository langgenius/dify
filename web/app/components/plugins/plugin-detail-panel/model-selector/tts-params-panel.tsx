import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PortalSelect } from '@/app/components/base/select'
import { languages } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'

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
      <div className="mb-3">
        <div className="system-sm-semibold mb-1 flex items-center py-1 text-text-secondary">
          {t('voice.voiceSettings.language', { ns: 'appDebug' })}
        </div>
        <PortalSelect
          triggerClassName="h-8"
          popupClassName={cn('z-[1000]')}
          popupInnerClassName={cn('w-[354px]')}
          value={language}
          items={languages.filter(item => item.supported)}
          onSelect={item => setLanguage(item.value as string)}
        />
      </div>
      <div className="mb-3">
        <div className="system-sm-semibold mb-1 flex items-center py-1 text-text-secondary">
          {t('voice.voiceSettings.voice', { ns: 'appDebug' })}
        </div>
        <PortalSelect
          triggerClassName="h-8"
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
