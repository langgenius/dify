import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/base/ui/select'
import { languages } from '@/i18n-config/language'

type Props = {
  currentModel: any
  language: string
  voice: string
  onChange: (language: string, voice: string) => void
}

const supportedLanguages = languages.filter(item => item.supported)

const TTSParamsPanel = ({
  currentModel,
  language,
  voice,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const voiceList = useMemo<Array<{ label: string, value: string }>>(() => {
    if (!currentModel)
      return []
    return currentModel.model_properties.voices.map((item: { mode: string, name: string }) => ({
      label: item.name,
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
        <Select
          value={language}
          onValueChange={(value) => {
            if (value == null)
              return
            setLanguage(value)
          }}
        >
          <SelectTrigger
            className="w-full"
            data-testid="tts-language-select-trigger"
            aria-label={t('voice.voiceSettings.language', { ns: 'appDebug' })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent popupClassName="w-[354px]">
            {supportedLanguages.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-3">
        <div className="system-sm-semibold mb-1 flex items-center py-1 text-text-secondary">
          {t('voice.voiceSettings.voice', { ns: 'appDebug' })}
        </div>
        <Select
          value={voice}
          onValueChange={(value) => {
            if (value == null)
              return
            setVoice(value)
          }}
        >
          <SelectTrigger
            className="w-full"
            data-testid="tts-voice-select-trigger"
            aria-label={t('voice.voiceSettings.voice', { ns: 'appDebug' })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent popupClassName="w-[354px]">
            {voiceList.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

export default TTSParamsPanel
