'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { env } from '@/env'
import ParamItem from '.'

type Props = {
  className?: string
  value: number
  onChange: (key: string, value: number) => void
  enable: boolean
}

const maxTopK = env.NEXT_PUBLIC_TOP_K_MAX_VALUE
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
