import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { FeatureEnum } from '@/app/components/base/features/types'
import { Citations } from '@/app/components/base/icons/src/vender/features'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
}

const Citation = ({
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
      onChange(newFeatures)
  }, [featuresStore, onChange])

  return (
    <FeatureCard
      icon={(
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-warning-warning-500 p-1 shadow-xs">
          <Citations className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )}
      title={t('feature.citation.title', { ns: 'appDebug' })}
      value={!!features.citation?.enabled}
      description={t('feature.citation.description', { ns: 'appDebug' })!}
      onChange={state => handleChange(FeatureEnum.citation, state)}
      disabled={disabled}
    />
  )
}

export default Citation
