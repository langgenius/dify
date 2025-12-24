'use client'
import type { DataSourceSelectorProps } from './types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ENABLE_WEBSITE_FIRECRAWL, ENABLE_WEBSITE_JINAREADER, ENABLE_WEBSITE_WATERCRAWL } from '@/config'
import { DataSourceType } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import s from './index.module.css'

type DataSourceConfig = {
  type: DataSourceType
  iconClassName?: string
  labelKey: string
  isEnabled: boolean
}

/**
 * Data source type selector component
 * Allows users to choose between File, Notion, and Web data sources
 */
const DataSourceSelector = ({
  dataSourceType,
  dataSourceTypeDisable,
  changeType,
  onHideFilePreview,
  onHideNotionPreview,
  onHideWebsitePreview,
}: DataSourceSelectorProps) => {
  const { t } = useTranslation()
  const isWebEnabled = ENABLE_WEBSITE_FIRECRAWL || ENABLE_WEBSITE_JINAREADER || ENABLE_WEBSITE_WATERCRAWL

  // Configuration for all data source types
  const dataSourceConfigs: DataSourceConfig[] = useMemo(() => [
    {
      type: DataSourceType.FILE,
      labelKey: 'datasetCreation.stepOne.dataSourceType.file',
      isEnabled: true,
    },
    {
      type: DataSourceType.NOTION,
      iconClassName: s.notion,
      labelKey: 'datasetCreation.stepOne.dataSourceType.notion',
      isEnabled: true,
    },
    {
      type: DataSourceType.WEB,
      iconClassName: s.web,
      labelKey: 'datasetCreation.stepOne.dataSourceType.web',
      isEnabled: isWebEnabled,
    },
  ], [isWebEnabled])

  // Map of hide preview functions for each data source type
  const hidePreviewMap = useMemo(() => ({
    [DataSourceType.FILE]: onHideFilePreview,
    [DataSourceType.NOTION]: onHideNotionPreview,
    [DataSourceType.WEB]: onHideWebsitePreview,
  }), [onHideFilePreview, onHideNotionPreview, onHideWebsitePreview])

  // Generic click handler for all data source types
  const handleClick = (type: DataSourceType) => {
    if (dataSourceTypeDisable)
      return
    changeType(type)
    // Hide previews for other data source types
    Object.entries(hidePreviewMap).forEach(([key, hideFn]) => {
      if (key !== type)
        hideFn()
    })
  }

  return (
    <div className="mb-8 grid grid-cols-3 gap-4">
      {dataSourceConfigs
        .filter(config => config.isEnabled)
        .map(config => (
          <div
            key={config.type}
            className={cn(
              s.dataSourceItem,
              'system-sm-medium',
              dataSourceType === config.type && s.active,
              dataSourceTypeDisable && dataSourceType !== config.type && s.disabled,
            )}
            onClick={() => handleClick(config.type)}
          >
            <span className={cn(s.datasetIcon, config.iconClassName)} />
            <span title={t(config.labelKey)!} className="truncate">
              {t(config.labelKey)}
            </span>
          </div>
        ))}
    </div>
  )
}

export default DataSourceSelector
