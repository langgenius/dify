'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ParamItem from '.'

type Props = {
  className?: string
  value: number
  onChange: (key: string, value: number) => void
  enable: boolean
}

const VALUE_LIMIT = {
  default: 2,
  step: 1,
  min: 1,
  max: 10,
}

const key = 'top_k'
const TopKItem: FC<Props> = ({
  className,
  value,
  enable,
  onChange,
}) => {
  const { t } = useTranslation()
  const handleParamChange = (key: string, value: number) => {
    let notOutRangeValue = parseFloat(value.toFixed(2))
    notOutRangeValue = Math.max(VALUE_LIMIT.min, notOutRangeValue)
    notOutRangeValue = Math.min(VALUE_LIMIT.max, notOutRangeValue)
    onChange(key, notOutRangeValue)
  }
  return (
    <ParamItem
      className={className}
      id={key}
      name={t(`appDebug.datasetConfig.${key}`)}
      tip={t(`appDebug.datasetConfig.${key}Tip`) as string}
      {...VALUE_LIMIT}
      value={value}
      enable={enable}
      onChange={handleParamChange}
    />
  )
}
export default React.memo(TopKItem)
