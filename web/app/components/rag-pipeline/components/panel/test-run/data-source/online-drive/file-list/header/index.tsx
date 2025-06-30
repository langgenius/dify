import React, { useState } from 'react'
import Breadcrumbs from './breadcrumbs'
import Input from '@/app/components/base/input'
import { useDebounceFn } from 'ahooks'
import { useTranslation } from 'react-i18next'

type HeaderProps = {
  prefix: string[]
  keywords: string
  resetKeywords: () => void
  updateKeywords: (keywords: string) => void
  searchResultsLength: number
}

const Header = ({
  prefix,
  keywords,
  resetKeywords,
  updateKeywords,
  searchResultsLength,
}: HeaderProps) => {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState(keywords)

  const { run: updateKeywordsWithDebounce } = useDebounceFn(
    (keywords: string) => {
      updateKeywords(keywords)
    },
    { wait: 500 },
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const keywords = e.target.value
    setInputValue(keywords)
    updateKeywordsWithDebounce(keywords)
  }

  const handleResetKeywords = () => {
    setInputValue('')
    resetKeywords()
  }

  return (
    <div className='flex items-center gap-x-2 bg-components-panel-bg p-1 pl-3'>
      <Breadcrumbs
        prefix={prefix}
        keywords={keywords}
        resetKeywords={resetKeywords}
        searchResultsLength={searchResultsLength}
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
