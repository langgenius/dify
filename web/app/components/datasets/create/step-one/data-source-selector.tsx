'use client'
import type { DataSourceSelectorProps } from './types'
import { useTranslation } from 'react-i18next'
import { ENABLE_WEBSITE_FIRECRAWL, ENABLE_WEBSITE_JINAREADER, ENABLE_WEBSITE_WATERCRAWL } from '@/config'
import { DataSourceType } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import s from './index.module.css'

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

  const handleFileClick = () => {
    if (dataSourceTypeDisable)
      return
    changeType(DataSourceType.FILE)
    onHideNotionPreview()
    onHideWebsitePreview()
  }

  const handleNotionClick = () => {
    if (dataSourceTypeDisable)
      return
    changeType(DataSourceType.NOTION)
    onHideFilePreview()
    onHideWebsitePreview()
  }

  const handleWebClick = () => {
    if (dataSourceTypeDisable)
      return
    changeType(DataSourceType.WEB)
    onHideFilePreview()
    onHideNotionPreview()
  }

  return (
    <div className="mb-8 grid grid-cols-3 gap-4">
      {/* File data source */}
      <div
        className={cn(
          s.dataSourceItem,
          'system-sm-medium',
          dataSourceType === DataSourceType.FILE && s.active,
          dataSourceTypeDisable && dataSourceType !== DataSourceType.FILE && s.disabled,
        )}
        onClick={handleFileClick}
      >
        <span className={cn(s.datasetIcon)} />
        <span
          title={t('datasetCreation.stepOne.dataSourceType.file')!}
          className="truncate"
        >
          {t('datasetCreation.stepOne.dataSourceType.file')}
        </span>
      </div>

      {/* Notion data source */}
      <div
        className={cn(
          s.dataSourceItem,
          'system-sm-medium',
          dataSourceType === DataSourceType.NOTION && s.active,
          dataSourceTypeDisable && dataSourceType !== DataSourceType.NOTION && s.disabled,
        )}
        onClick={handleNotionClick}
      >
        <span className={cn(s.datasetIcon, s.notion)} />
        <span
          title={t('datasetCreation.stepOne.dataSourceType.notion')!}
          className="truncate"
        >
          {t('datasetCreation.stepOne.dataSourceType.notion')}
        </span>
      </div>

      {/* Web data source */}
      {isWebEnabled && (
        <div
          className={cn(
            s.dataSourceItem,
            'system-sm-medium',
            dataSourceType === DataSourceType.WEB && s.active,
            dataSourceTypeDisable && dataSourceType !== DataSourceType.WEB && s.disabled,
          )}
          onClick={handleWebClick}
        >
          <span className={cn(s.datasetIcon, s.web)} />
          <span
            title={t('datasetCreation.stepOne.dataSourceType.web')!}
            className="truncate"
          >
            {t('datasetCreation.stepOne.dataSourceType.web')}
          </span>
        </div>
      )}
    </div>
  )
}

export default DataSourceSelector
