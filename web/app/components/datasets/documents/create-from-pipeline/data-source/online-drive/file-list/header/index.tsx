import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import Breadcrumbs from './breadcrumbs'

type HeaderProps = {
  breadcrumbs: string[]
  inputValue: string
  keywords: string
  bucket: string
  searchResultsLength: number
  onSearchValueChange: (value: string) => void
  isInPipeline: boolean
}

const Header = ({
  breadcrumbs,
  inputValue,
  keywords,
  bucket,
  isInPipeline,
  searchResultsLength,
  onSearchValueChange,
}: HeaderProps) => {
  const { t } = useTranslation()
  const searchLabel = t(($) => $['onlineDrive.breadcrumbs.searchPlaceholder'], {
    ns: 'datasetPipeline',
  })

  return (
    <div className="flex items-center gap-x-2 bg-components-panel-bg p-1 pl-3">
      <Breadcrumbs
        breadcrumbs={breadcrumbs}
        keywords={keywords}
        bucket={bucket}
        searchResultsLength={searchResultsLength}
        isInPipeline={isInPipeline}
      />
      <SearchInput
        className="h-8 w-50 shrink-0"
        value={inputValue}
        onValueChange={onSearchValueChange}
        aria-label={searchLabel}
        placeholder={searchLabel}
      />
    </div>
  )
}

export default React.memo(Header)
