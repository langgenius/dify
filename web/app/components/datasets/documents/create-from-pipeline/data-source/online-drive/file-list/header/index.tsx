import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import type { OnlineDriveViewMode } from '@/models/pipeline'
import Breadcrumbs from './breadcrumbs'
import ViewToggle from './view-toggle'

type HeaderProps = {
  breadcrumbs: string[]
  inputValue: string
  keywords: string
  bucket: string
  searchResultsLength: number
  handleInputChange: React.ChangeEventHandler<HTMLInputElement>
  handleResetKeywords: () => void
  isInPipeline: boolean
  viewMode: OnlineDriveViewMode
  onViewModeChange: (mode: OnlineDriveViewMode) => void
}

const Header = ({
  breadcrumbs,
  inputValue,
  keywords,
  bucket,
  isInPipeline,
  searchResultsLength,
  handleInputChange,
  handleResetKeywords,
  viewMode,
  onViewModeChange,
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-2 bg-components-panel-bg p-1 pl-3">
      <Breadcrumbs
        breadcrumbs={breadcrumbs}
        keywords={keywords}
        bucket={bucket}
        searchResultsLength={searchResultsLength}
        isInPipeline={isInPipeline}
      />

      <ViewToggle
        viewMode={viewMode}
        onChange={onViewModeChange}
      />

      <Input
        value={inputValue}
        onChange={handleInputChange}
        onClear={handleResetKeywords}
        placeholder={t('onlineDrive.breadcrumbs.searchPlaceholder', { ns: 'datasetPipeline' })}
        showLeftIcon
        showClearIcon
        wrapperClassName="w-[200px] h-8 shrink-0"
      />
    </div>
  )
}

export default React.memo(Header)
