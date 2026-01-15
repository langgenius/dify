import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber } from '@/app/components/base/input-number'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'

export type TopKAndScoreThresholdProps = {
  topK: number
  onTopKChange: (value: number) => void
  scoreThreshold?: number
  onScoreThresholdChange?: (value: number) => void
  isScoreThresholdEnabled?: boolean
  onScoreThresholdEnabledChange?: (value: boolean) => void
  readonly?: boolean
  hiddenScoreThreshold?: boolean
}

const maxTopK = (() => {
  const configValue = Number.parseInt(globalThis.document?.body?.getAttribute('data-public-top-k-max-value') || '', 10)
  if (configValue && !isNaN(configValue))
    return configValue
  return 10
})()
const TOP_K_VALUE_LIMIT = {
  amount: 1,
  min: 1,
  max: maxTopK,
}
const SCORE_THRESHOLD_VALUE_LIMIT = {
  step: 0.01,
  min: 0,
  max: 1,
}

const TopKAndScoreThreshold = ({
  topK,
  onTopKChange,
  scoreThreshold,
  onScoreThresholdChange,
  isScoreThresholdEnabled,
  onScoreThresholdEnabledChange,
  readonly,
  hiddenScoreThreshold,
}: TopKAndScoreThresholdProps) => {
  const { t } = useTranslation()
  const handleTopKChange = useCallback((value: number) => {
    let notOutRangeValue = Number.parseInt(value.toFixed(0))
    notOutRangeValue = Math.max(TOP_K_VALUE_LIMIT.min, notOutRangeValue)
    notOutRangeValue = Math.min(TOP_K_VALUE_LIMIT.max, notOutRangeValue)
    onTopKChange?.(notOutRangeValue)
  }, [onTopKChange])

  const handleScoreThresholdChange = (value: number) => {
    let notOutRangeValue = Number.parseFloat(value.toFixed(2))
    notOutRangeValue = Math.max(SCORE_THRESHOLD_VALUE_LIMIT.min, notOutRangeValue)
    notOutRangeValue = Math.min(SCORE_THRESHOLD_VALUE_LIMIT.max, notOutRangeValue)
    onScoreThresholdChange?.(notOutRangeValue)
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="system-xs-medium mb-0.5 flex h-6 items-center text-text-secondary">
          {t('datasetConfig.top_k', { ns: 'appDebug' })}
          <Tooltip
            triggerClassName="ml-0.5 shrink-0 w-3.5 h-3.5"
            popupContent={t('datasetConfig.top_kTip', { ns: 'appDebug' })}
          />
        </div>
        <InputNumber
          disabled={readonly}
          type="number"
          {...TOP_K_VALUE_LIMIT}
          size="regular"
          value={topK}
          onChange={handleTopKChange}
        />
      </div>
      {
        !hiddenScoreThreshold && (
          <div>
            <div className="mb-0.5 flex h-6 items-center">
              <Switch
                className="mr-2"
                defaultValue={isScoreThresholdEnabled}
                onChange={onScoreThresholdEnabledChange}
                disabled={readonly}
              />
              <div className="system-sm-medium grow truncate text-text-secondary">
                {t('datasetConfig.score_threshold', { ns: 'appDebug' })}
              </div>
              <Tooltip
                triggerClassName="shrink-0 ml-0.5 w-3.5 h-3.5"
                popupContent={t('datasetConfig.score_thresholdTip', { ns: 'appDebug' })}
              />
            </div>
            <InputNumber
              disabled={readonly || !isScoreThresholdEnabled}
              type="number"
              {...SCORE_THRESHOLD_VALUE_LIMIT}
              size="regular"
              value={scoreThreshold}
              onChange={handleScoreThresholdChange}
            />
          </div>
        )
      }
    </div>
  )
}

export default memo(TopKAndScoreThreshold)
