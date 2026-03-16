import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/app/components/base/ui/number-field'
import { env } from '@/env'

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

const maxTopK = env.NEXT_PUBLIC_TOP_K_MAX_VALUE
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
    onTopKChange?.(Number.parseInt(value.toFixed(0)))
  }, [onTopKChange])

  const handleScoreThresholdChange = (value: number) => {
    onScoreThresholdChange?.(Number.parseFloat(value.toFixed(2)))
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="mb-0.5 flex h-6 items-center text-text-secondary system-xs-medium">
          {t('datasetConfig.top_k', { ns: 'appDebug' })}
          <Tooltip
            triggerClassName="ml-0.5 shrink-0 w-3.5 h-3.5"
            popupContent={t('datasetConfig.top_kTip', { ns: 'appDebug' })}
          />
        </div>
        <NumberField
          disabled={readonly}
          step={TOP_K_VALUE_LIMIT.amount}
          min={TOP_K_VALUE_LIMIT.min}
          max={TOP_K_VALUE_LIMIT.max}
          value={topK}
          onValueChange={value => handleTopKChange(value ?? 0)}
        >
          <NumberFieldGroup size="regular">
            <NumberFieldInput size="regular" />
            <NumberFieldControls>
              <NumberFieldIncrement size="regular" />
              <NumberFieldDecrement size="regular" />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </div>
      {
        !hiddenScoreThreshold && (
          <div>
            <div className="mb-0.5 flex h-6 items-center">
              <Switch
                className="mr-2"
                value={isScoreThresholdEnabled ?? false}
                onChange={onScoreThresholdEnabledChange}
                disabled={readonly}
              />
              <div className="grow truncate text-text-secondary system-sm-medium">
                {t('datasetConfig.score_threshold', { ns: 'appDebug' })}
              </div>
              <Tooltip
                triggerClassName="shrink-0 ml-0.5 w-3.5 h-3.5"
                popupContent={t('datasetConfig.score_thresholdTip', { ns: 'appDebug' })}
              />
            </div>
            <NumberField
              disabled={readonly || !isScoreThresholdEnabled}
              step={SCORE_THRESHOLD_VALUE_LIMIT.step}
              min={SCORE_THRESHOLD_VALUE_LIMIT.min}
              max={SCORE_THRESHOLD_VALUE_LIMIT.max}
              value={scoreThreshold ?? null}
              onValueChange={value => handleScoreThresholdChange(value ?? 0)}
            >
              <NumberFieldGroup size="regular">
                <NumberFieldInput size="regular" />
                <NumberFieldControls>
                  <NumberFieldIncrement size="regular" />
                  <NumberFieldDecrement size="regular" />
                </NumberFieldControls>
              </NumberFieldGroup>
            </NumberField>
          </div>
        )
      }
    </div>
  )
}

export default memo(TopKAndScoreThreshold)
