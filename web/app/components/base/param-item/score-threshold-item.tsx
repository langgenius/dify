'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ParamItem from '.'

type Props = {
  className?: string
  value?: number
  onChange: (key: string, value: number) => void
  enable: boolean
  hasSwitch?: boolean
  onSwitchChange?: (key: string, enable: boolean) => void
}

const VALUE_LIMIT = {
  default: 0.7,
  step: 0.01,
  min: 0,
  max: 1,
}

const normalizeScoreThreshold = (value?: number): number => {
  const normalizedValue = typeof value === 'number' && Number.isFinite(value)
    ? value
    : VALUE_LIMIT.default
  const roundedValue = Number.parseFloat(normalizedValue.toFixed(2))

  return Math.min(
    VALUE_LIMIT.max,
    Math.max(VALUE_LIMIT.min, roundedValue),
  )
}

const ScoreThresholdItem: FC<Props> = ({
  className,
  value,
  enable,
  onChange,
  hasSwitch,
  onSwitchChange,
}) => {
  const { t } = useTranslation()
  const handleParamChange = (key: string, nextValue: number) => {
    onChange(key, normalizeScoreThreshold(nextValue))
  }
  const safeValue = normalizeScoreThreshold(value)

  return (
    <ParamItem
      className={className}
      id="score_threshold"
      name={t('datasetConfig.score_threshold', { ns: 'appDebug' })}
      tip={t('datasetConfig.score_thresholdTip', { ns: 'appDebug' }) as string}
      {...VALUE_LIMIT}
      value={safeValue}
      enable={enable}
      onChange={handleParamChange}
      hasSwitch={hasSwitch}
      onSwitchChange={onSwitchChange}
    />
  )
}
export default React.memo(ScoreThresholdItem)
