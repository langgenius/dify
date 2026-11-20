import type { OnFeaturesChange } from '../types'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '../hooks'
import FeatureCard from './feature-card'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
}

export default function GenerativeUI({ disabled, onChange }: Props) {
  const { t } = useTranslation(['appDebug'])
  const enabled = useFeatures((state) => !!state.features.generativeUI?.enabled)
  const featuresStore = useFeaturesStore()

  const handleChange = (enabled: boolean) => {
    if (!featuresStore) return
    const { features, setFeatures } = featuresStore.getState()
    const nextFeatures = { ...features, generativeUI: { enabled } }
    setFeatures(nextFeatures)
    onChange?.(nextFeatures)
  }

  return (
    <FeatureCard
      icon={
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-600 p-1 shadow-xs">
          <span
            aria-hidden="true"
            className="i-custom-vender-workflow-window-cursor size-4 text-text-primary-on-surface"
          />
        </div>
      }
      title={t(($) => $['generativeUI.title'])}
      description={t(($) => $['generativeUI.description'])}
      value={enabled}
      disabled={disabled}
      onChange={handleChange}
    />
  )
}
