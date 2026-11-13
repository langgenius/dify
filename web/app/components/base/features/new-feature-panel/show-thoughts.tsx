import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { FeatureEnum } from '@/app/components/base/features/types'

type Props = Readonly<{
  disabled?: boolean
  onChange?: OnFeaturesChange
}>

const ShowThoughts = ({ disabled, onChange }: Props) => {
  const { t } = useTranslation(['appDebug'])
  const features = useFeatures((s) => s.features)
  const featuresStore = useFeaturesStore()

  const handleChange = useCallback(
    (type: FeatureEnum, enabled: boolean) => {
      const { features, setFeatures } = featuresStore!.getState()

      const newFeatures = produce(features, (draft) => {
        draft[type] = {
          ...draft[type],
          enabled,
        }
      })
      setFeatures(newFeatures)
      if (onChange) onChange(newFeatures)
    },
    [featuresStore, onChange],
  )

  return (
    <FeatureCard
      icon={
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-warning-warning-500 p-1 shadow-xs">
          <span
            aria-hidden
            className="i-ri-lightbulb-flash-line size-4 text-text-primary-on-surface"
          />
        </div>
      }
      title={t(($) => $['feature.showThoughts.title'], { ns: 'appDebug' })}
      value={!!features.showThoughts?.enabled}
      description={t(($) => $['feature.showThoughts.description'], { ns: 'appDebug' })!}
      onChange={(state) => handleChange(FeatureEnum.showThoughts, state)}
      disabled={disabled}
    />
  )
}

export default ShowThoughts
