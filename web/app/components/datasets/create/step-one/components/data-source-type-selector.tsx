'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ENABLE_WEBSITE_FIRECRAWL,
  ENABLE_WEBSITE_JINAREADER,
  ENABLE_WEBSITE_WATERCRAWL,
} from '@/config'
import { DataSourceType } from '@/models/datasets'
import s from '../index.module.css'

type DataSourceTypeSelectorProps = {
  labelledBy?: string
  currentType: DataSourceType
  disabled: boolean
  onChange: (type: DataSourceType) => void
  onClearPreviews: (type: DataSourceType) => void
}

type DataSourceLabelKey =
  | 'stepOne.dataSourceType.file'
  | 'stepOne.dataSourceType.notion'
  | 'stepOne.dataSourceType.web'

type DataSourceOption = {
  type: DataSourceType
  iconClass?: string
  labelKey: DataSourceLabelKey
}

const DATA_SOURCE_OPTIONS: DataSourceOption[] = [
  {
    type: DataSourceType.FILE,
    labelKey: 'stepOne.dataSourceType.file',
  },
  {
    type: DataSourceType.NOTION,
    iconClass: s.notion,
    labelKey: 'stepOne.dataSourceType.notion',
  },
  {
    type: DataSourceType.WEB,
    iconClass: s.web,
    labelKey: 'stepOne.dataSourceType.web',
  },
]

/**
 * Data source type selector component for choosing between file, notion, and web sources.
 */
function DataSourceTypeSelector({
  labelledBy,
  currentType,
  disabled,
  onChange,
  onClearPreviews,
}: DataSourceTypeSelectorProps) {
  const { t } = useTranslation()

  const isWebEnabled =
    ENABLE_WEBSITE_FIRECRAWL || ENABLE_WEBSITE_JINAREADER || ENABLE_WEBSITE_WATERCRAWL

  const handleTypeChange = useCallback(
    (type: DataSourceType) => {
      if (disabled) return
      onChange(type)
      onClearPreviews(type)
    },
    [disabled, onChange, onClearPreviews],
  )

  const visibleOptions = useMemo(
    () =>
      DATA_SOURCE_OPTIONS.filter((option) => {
        if (option.type === DataSourceType.WEB) return isWebEnabled
        return true
      }),
    [isWebEnabled],
  )

  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : t(($) => $['steps.one'], { ns: 'datasetCreation' })}
      value={currentType}
      disabled={disabled}
      onValueChange={handleTypeChange}
      className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {visibleOptions.map((option) => (
        <RadioItem
          key={option.type}
          value={option.type}
          className={cn(
            s.dataSourceItem,
            'system-sm-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active',
            currentType === option.type && s.active,
            disabled && currentType !== option.type && s.disabled,
          )}
        >
          <span className={cn(s.datasetIcon, option.iconClass)} />
          <span
            title={t(($) => $[option.labelKey], { ns: 'datasetCreation' }) || undefined}
            className="truncate"
          >
            {t(($) => $[option.labelKey], { ns: 'datasetCreation' })}
          </span>
        </RadioItem>
      ))}
    </RadioGroup>
  )
}

export default DataSourceTypeSelector
