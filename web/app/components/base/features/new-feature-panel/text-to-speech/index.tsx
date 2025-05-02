import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { RiEqualizer2Line } from '@remixicon/react'
import { TextToAudio } from '@/app/components/base/icons/src/vender/features'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import Button from '@/app/components/base/button'
import VoiceSettings from '@/app/components/base/features/new-feature-panel/text-to-speech/voice-settings'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'
import { languages } from '@/i18n/language'
import { TtsAutoPlay } from '@/types/app'

type Props = {
  disabled: boolean
  onChange?: OnFeaturesChange
}

const TextToSpeech = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const textToSpeech = useFeatures(s => s.features.text2speech) // .language .voice .autoPlay
  const languageInfo = languages.find(i => i.value === textToSpeech?.language)
  const [modalOpen, setModalOpen] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const features = useFeatures(s => s.features)
  const featuresStore = useFeaturesStore()

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft[type] = {
        ...draft[type],
        enabled,
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }, [featuresStore, onChange])

  return (
    <FeatureCard
      icon={
        <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-600 p-1 shadow-xs'>
          <TextToAudio className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      }
      title={t('appDebug.feature.textToSpeech.title')}
      value={!!features.text2speech?.enabled}
      onChange={state => handleChange(FeatureEnum.text2speech, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!features.text2speech?.enabled && (
          <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>{t('appDebug.feature.textToSpeech.description')}</div>
        )}
        {!!features.text2speech?.enabled && (
          <>
            {!isHovering && !modalOpen && (
              <div className='flex items-center gap-4 pt-0.5'>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.voice.voiceSettings.language')}</div>
                  <div className='system-xs-regular text-text-secondary'>{languageInfo?.name || '-'}</div>
                </div>
                <div className='h-[27px] w-px rotate-12 bg-divider-subtle'></div>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.voice.voiceSettings.voice')}</div>
                  <div className='system-xs-regular text-text-secondary'>{features.text2speech?.voice || t('appDebug.voice.defaultDisplay')}</div>
                </div>
                <div className='h-[27px] w-px rotate-12 bg-divider-subtle'></div>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.voice.voiceSettings.autoPlay')}</div>
                  <div className='system-xs-regular text-text-secondary'>{features.text2speech?.autoPlay === TtsAutoPlay.enabled ? t('appDebug.voice.voiceSettings.autoPlayEnabled') : t('appDebug.voice.voiceSettings.autoPlayDisabled')}</div>
                </div>
              </div>
            )}
            {(isHovering || modalOpen) && (
              <VoiceSettings open={modalOpen && !disabled} onOpen={setModalOpen} onChange={onChange}>
                <Button className='w-full' disabled={disabled}>
                  <RiEqualizer2Line className='mr-1 h-4 w-4' />
                  {t('appDebug.voice.voiceSettings.title')}
                </Button>
              </VoiceSettings>
            )}
          </>
        )}
      </>
    </FeatureCard>
  )
}

export default TextToSpeech
