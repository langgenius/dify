import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { FeatureEnum } from '@/app/components/base/features/types'
import { Microphone01 } from '@/app/components/base/icons/src/vender/features'

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
      icon={(
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-600 p-1 shadow-xs">
          <Microphone01 className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )}
      title={t('feature.speechToText.title', { ns: 'appDebug' })}
      value={!!features.speech2text?.enabled}
      description={t('feature.speechToText.description', { ns: 'appDebug' })!}
      onChange={state => handleChange(FeatureEnum.speech2text, state)}
      disabled={disabled}
    />
  )
}

export default SpeechToText
