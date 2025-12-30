'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ParamItem from '.'

type Props = {
  className?: string
  value: number
  onChange: (key: string, value: number) => void
  enable: boolean
}

const maxTopK = (() => {
  const configValue = Number.parseInt(globalThis.document?.body?.getAttribute('data-public-top-k-max-value') || '', 10)
  if (configValue && !isNaN(configValue))
    return configValue
  return 10
})()
const VALUE_LIMIT = {
  default: 2,
  step: 1,
  min: 1,
  max: maxTopK,
}

const TopKItem: FC<Props> = ({
  className,
  value,
  enable,
  onChange,
}) => {
  const { t } = useTranslation()
  const handleParamChange = (key: string, value: number) => {
    let notOutRangeValue = Number.parseInt(value.toFixed(0))
    notOutRangeValue = Math.max(VALUE_LIMIT.min, notOutRangeValue)
    notOutRangeValue = Math.min(VALUE_LIMIT.max, notOutRangeValue)
    onChange(key, notOutRangeValue)
  }
  return (
    <ParamItem
      className={className}
      id="top_k"
      name={t('datasetConfig.top_k', { ns: 'appDebug' })}
      tip={t('datasetConfig.top_kTip', { ns: 'appDebug' }) as string}
      {...VALUE_LIMIT}
      value={value}
      enable={enable}
      onChange={handleParamChange}
    />
  )
}
export default React.memo(TopKItem)
