import type {
  OnFeaturesChange,
  SuggestedQuestionsAfterAnswer,
} from '@/app/components/base/features/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { FollowUpSettingsDialog } from '@/app/components/base/features/new-feature-panel/follow-up-setting-modal'
import { FeatureEnum } from '@/app/components/base/features/types'

type Props = Readonly<{
  disabled?: boolean
  onChange?: OnFeaturesChange
}>

export function FollowUp({ disabled, onChange }: Props) {
  const { t } = useTranslation(['appDebug', 'common'])
  const suggested = useFeatures((s) => s.features.suggested)
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

  const handleSave = useCallback(
    (newSuggested: SuggestedQuestionsAfterAnswer) => {
      const { features, setFeatures } = featuresStore!.getState()

      const newFeatures = produce(features, (draft) => {
        draft.suggested = {
          ...newSuggested,
          enabled: true,
        }
      })
      setFeatures(newFeatures)
      if (onChange) onChange(newFeatures)
    },
    [featuresStore, onChange],
  )

  return (
    <div className="group/follow-up">
      <FeatureCard
        icon={
          <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs">
            <span
              aria-hidden
              className="i-custom-vender-features-virtual-assistant size-4 text-text-primary-on-surface"
            />
          </div>
        }
        title={t(($) => $['feature.suggestedQuestionsAfterAnswer.title'], { ns: 'appDebug' })}
        value={!!suggested?.enabled}
        onChange={(state) => handleChange(FeatureEnum.suggested, state)}
        disabled={disabled}
      >
        <>
          {!suggested?.enabled && (
            <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
              {t(($) => $['feature.suggestedQuestionsAfterAnswer.description'], { ns: 'appDebug' })}
            </div>
          )}
          {!!suggested?.enabled && (
            <FollowUpSettingsDialog data={suggested} onSave={handleSave} disabled={disabled} />
          )}
        </>
      </FeatureCard>
    </div>
  )
}
