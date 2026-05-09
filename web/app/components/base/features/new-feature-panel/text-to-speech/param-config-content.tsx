'use client'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { produce } from 'immer'
import { useTranslation } from 'react-i18next'
import { replace } from 'string-ts'
import AudioBtn from '@/app/components/base/audio-btn'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { Infotip } from '@/app/components/base/infotip'
import { languages } from '@/i18n-config/language'
import { usePathname } from '@/next/navigation'
import { useAppVoices } from '@/service/use-apps'
import { TtsAutoPlay } from '@/types/app'

type SelectOption = {
  value: string | number
  name: string
}

type VoiceParamConfigProps = {
  onClose: () => void
  onChange?: OnFeaturesChange
}
const VoiceParamConfig = ({
  onClose,
  onChange,
}: VoiceParamConfigProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const text2speech = useFeatures(state => state.features.text2speech)
  const featuresStore = useFeaturesStore()
  const formatLanguageName = (item: SelectOption) => {
    return t(`voice.language.${replace(String(item.value), '-', '')}`, item.name, { ns: 'common' as const })
  }

  let languageItem = languages.find(item => item.value === text2speech?.language)
  if (languages && !languageItem)
    languageItem = languages[0]
  const localLanguagePlaceholder = languageItem?.name || t('placeholder.select', { ns: 'common' })

  const language = languageItem?.value
  const { data: voiceItems } = useAppVoices(appId, language)
  let voiceItem = voiceItems?.find(item => item.value === text2speech?.voice)
  if (voiceItems && !voiceItem)
    voiceItem = voiceItems[0]
  const localVoicePlaceholder = voiceItem?.name || t('placeholder.select', { ns: 'common' })

  const handleChange = (value: Record<string, string>) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft.text2speech = {
        ...draft.text2speech,
        ...value,
      }
    })

    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="system-xl-semibold text-text-primary">{t('voice.voiceSettings.title', { ns: 'appDebug' })}</div>
        <button
          type="button"
          className="rounded-md p-1 hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
          aria-label={t('appDebug:voice.voiceSettings.close')}
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line h-4 w-4 text-text-tertiary" />
        </button>
      </div>
      <div className="mb-3">
        <div className="mb-1 flex items-center py-1 system-sm-semibold text-text-secondary">
          {t('voice.voiceSettings.language', { ns: 'appDebug' })}
          <Infotip
            aria-label={t('voice.voiceSettings.resolutionTooltip', { ns: 'appDebug' })}
            popupClassName="w-[180px]"
          >
            {t('voice.voiceSettings.resolutionTooltip', { ns: 'appDebug' }).split('\n').map(item => (
              <div key={item}>
                {item}
              </div>
            ))}
          </Infotip>
        </div>
        <Select
          value={languageItem ? String(languageItem.value) : null}
          onValueChange={(nextValue) => {
            if (!nextValue)
              return
            handleChange({
              language: nextValue,
            })
          }}
        >
          <SelectTrigger aria-label={t('voice.voiceSettings.language', { ns: 'appDebug' })} className="w-full">
            {languageItem ? formatLanguageName(languageItem) : localLanguagePlaceholder}
          </SelectTrigger>
          <SelectContent listClassName="max-h-60">
            {languages.map(item => (
              <SelectItem key={item.value} value={String(item.value)}>
                <SelectItemText>
                  {formatLanguageName(item)}
                </SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-3">
        <div className="mb-1 py-1 system-sm-semibold text-text-secondary">
          {t('voice.voiceSettings.voice', { ns: 'appDebug' })}
        </div>
        <div className="flex items-center gap-1">
          <Select
            value={voiceItem ? String(voiceItem.value) : null}
            disabled={!languageItem}
            onValueChange={(nextValue) => {
              if (!nextValue)
                return
              handleChange({
                voice: nextValue,
              })
            }}
          >
            <div className="grow">
              <SelectTrigger aria-label={t('voice.voiceSettings.voice', { ns: 'appDebug' })} className="w-full">
                {voiceItem?.name ?? localVoicePlaceholder}
              </SelectTrigger>
              <SelectContent listClassName="max-h-60">
                {voiceItems?.map((item: SelectOption) => (
                  <SelectItem key={item.value} value={String(item.value)}>
                    <SelectItemText>
                      {item.name}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </div>
          </Select>
          {languageItem?.example && (
            <div className="h-8 shrink-0 rounded-lg bg-components-button-tertiary-bg p-1" data-testid="audition-button">
              <AudioBtn
                value={languageItem?.example}
                isAudition
                voice={text2speech?.voice}
                noCache
              />
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="mb-1 py-1 system-sm-semibold text-text-secondary">
          {t('voice.voiceSettings.autoPlay', { ns: 'appDebug' })}
        </div>
        <Switch
          className="shrink-0"
          checked={text2speech?.autoPlay === TtsAutoPlay.enabled}
          onCheckedChange={(value: boolean) => {
            handleChange({
              autoPlay: value ? TtsAutoPlay.enabled : TtsAutoPlay.disabled,
            })
          }}
        />
      </div>
    </>
  )
}

export default VoiceParamConfig
