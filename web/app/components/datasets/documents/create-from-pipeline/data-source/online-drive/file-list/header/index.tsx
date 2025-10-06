import React from 'react'
import Breadcrumbs from './breadcrumbs'
import Input from '@/app/components/base/input'
import { useTranslation } from 'react-i18next'

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
    <div className='flex items-center gap-x-2 bg-components-panel-bg p-1 pl-3'>
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
        placeholder={t('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')}
        showLeftIcon
        showClearIcon
        wrapperClassName='w-[200px] h-8 shrink-0'
      />
    </div>
  )
}

export default React.memo(Header)
