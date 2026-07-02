import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { Input } from '@langgenius/dify-ui/input'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'

type Props = Readonly<{
  disabled?: boolean
  onChange?: OnFeaturesChange
}>

const Engram = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const engram = useFeatures(s => s.features.engram)

  const update = useCallback((patch: { enabled?: boolean, api_key?: string, endpoint?: string }) => {
    const { features, setFeatures } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      draft.engram = { ...draft.engram, ...patch }
    })
    setFeatures(newFeatures)
    onChange?.(newFeatures)
  }, [featuresStore, onChange])

  return (
    <FeatureCard
      icon={(
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-500 p-1 shadow-xs">
          <span className="i-ri-brain-line size-4 text-text-primary-on-surface" />
        </div>
      )}
      title={t('feature.engram.title', { ns: 'appDebug' })}
      value={!!engram?.enabled}
      onChange={state => update({ enabled: state })}
      disabled={disabled}
    >
      {!engram?.enabled && (
        <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">{t('feature.engram.description', { ns: 'appDebug' })}</div>
      )}
      {!!engram?.enabled && (
        <div className="flex flex-col gap-3 pt-1">
          <div>
            <div className="mb-1 system-xs-medium text-text-secondary">{t('feature.engram.apiKey', { ns: 'appDebug' })}</div>
            <Input
              type="password"
              autoComplete="new-password"
              disabled={disabled}
              value={engram?.api_key || ''}
              placeholder={t('feature.engram.apiKeyPlaceholder', { ns: 'appDebug' })!}
              onChange={e => update({ api_key: e.target.value })}
            />
          </div>
          <div>
            <div className="mb-1 system-xs-medium text-text-secondary">{t('feature.engram.endpoint', { ns: 'appDebug' })}</div>
            <Input
              disabled={disabled}
              value={engram?.endpoint || ''}
              placeholder={t('feature.engram.endpointPlaceholder', { ns: 'appDebug' })!}
              onChange={e => update({ endpoint: e.target.value })}
            />
          </div>
        </div>
      )}
    </FeatureCard>
  )
}

export default React.memo(Engram)
