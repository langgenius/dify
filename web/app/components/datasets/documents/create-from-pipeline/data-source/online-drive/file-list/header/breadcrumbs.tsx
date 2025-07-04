import { BucketsGray } from '@/app/components/base/icons/src/public/knowledge/online-drive'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceStore } from '../../../store'
import Tooltip from '@/app/components/base/tooltip'

type BreadcrumbsProps = {
  prefix: string[]
  keywords: string
  bucket: string
  searchResultsLength: number
}

const Breadcrumbs = ({
  prefix,
  keywords,
  bucket,
  searchResultsLength,
}: BreadcrumbsProps) => {
  const { t } = useTranslation()
  const { setFileList, setSelectedFileList, setPrefix, setBucket } = useDataSourceStore().getState()
  const isRoot = prefix.length === 0 && bucket === ''
  const isSearching = !!keywords

  const handleBackToBucketList = useCallback(() => {
    setFileList([])
    setSelectedFileList([])
    setBucket('')
    setPrefix([])
  }, [setBucket, setFileList, setPrefix, setSelectedFileList])

  return (
    <div className='flex grow items-center py-1'>
      {isRoot && (
        <div className='system-sm-medium text-test-secondary px-[5px] py-1'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')}
        </div>
      )}
      {!isRoot && (
        <div className='flex items-center gap-x-0.5'>
          <Tooltip
            popupContent={t('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')}
          >
            <div
              className='flex size-5 cursor-pointer items-center justify-center'
              onClick={handleBackToBucketList}
            >
              <BucketsGray />
            </div>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export default React.memo(Breadcrumbs)
