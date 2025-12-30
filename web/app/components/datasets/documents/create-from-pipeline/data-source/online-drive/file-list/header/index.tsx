import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Breadcrumbs from './breadcrumbs'

type HeaderProps = {
  breadcrumbs: string[]
  inputValue: string
  keywords: string
  bucket: string
  searchResultsLength: number
  handleInputChange: React.ChangeEventHandler<HTMLInputElement>
  handleResetKeywords: () => void
  isInPipeline: boolean
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
