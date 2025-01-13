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
        <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-violet-violet-600'>
          <Microphone01 className='w-4 h-4 text-text-primary-on-surface' />
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
