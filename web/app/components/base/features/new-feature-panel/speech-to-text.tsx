import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { Microphone01 } from '@/app/components/base/icons/src/vender/features'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'

type Props = {
  disabled: boolean
  onChange?: OnFeaturesChange
}

const SpeechToText = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
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
        <div className='border-divider-subtle shadow-xs bg-util-colors-violet-violet-600 shrink-0 rounded-lg border-[0.5px] p-1'>
          <Microphone01 className='text-text-primary-on-surface h-4 w-4' />
        </div>
      }
      title={t('appDebug.feature.speechToText.title')}
      value={!!features.speech2text?.enabled}
      description={t('appDebug.feature.speechToText.description')!}
      onChange={state => handleChange(FeatureEnum.speech2text, state)}
      disabled={disabled}
    />
  )
}

export default SpeechToText
