import React from 'react'
import { useTranslation } from 'react-i18next'

type BreadcrumbsProps = {
  prefix: string[]
  keywords: string
  resetKeywords: () => void
  searchResultsLength: number
}

const Breadcrumbs = ({
  prefix,
  keywords,
  resetKeywords,
  searchResultsLength,
}: BreadcrumbsProps) => {
  const { t } = useTranslation()
  const isRoot = prefix.length === 0
  const isSearching = !!keywords

  return (
    <div className='flex grow items-center py-1'>
      {isRoot && (
        <div className='system-sm-medium text-test-secondary px-[5px] py-1'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')}
        </div>
      )}
      {!isRoot && (
        <div></div>
      )}
    </div>
  )
}

export default React.memo(Breadcrumbs)
