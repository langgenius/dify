import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { RiSparklingFill } from '@remixicon/react'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
}

const MoreLikeThis = ({
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
        <div className='border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500 shrink-0 rounded-lg border-[0.5px] p-1'>
          <RiSparklingFill className='text-text-primary-on-surface h-4 w-4' />
        </div>
      }
      title={t('appDebug.feature.moreLikeThis.title')}
      tooltip={t('appDebug.feature.moreLikeThis.tip')}
      value={!!features.moreLikeThis?.enabled}
      description={t('appDebug.feature.moreLikeThis.description')!}
      onChange={state => handleChange(FeatureEnum.moreLikeThis, state)}
      disabled={disabled}
    />
  )
}

export default MoreLikeThis
