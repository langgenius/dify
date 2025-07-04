import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceStore } from '../../../../store'
import Bucket from './bucket'
import BreadcrumbItem from './item'
import Dropdown from './dropdown'

type BreadcrumbsProps = {
  prefix: string[]
  keywords: string
  bucket: string
  searchResultsLength: number
  isInPipeline: boolean
}

const Breadcrumbs = ({
  prefix,
  keywords,
  bucket,
  searchResultsLength,
  isInPipeline,
}: BreadcrumbsProps) => {
  const { t } = useTranslation()
  const { setFileList, setSelectedFileList, setPrefix, setBucket } = useDataSourceStore().getState()
  const showSearchResult = !!keywords && searchResultsLength > 0
  const isRoot = prefix.length === 0 && bucket === ''

  const displayBreadcrumbNum = useMemo(() => {
    const num = isInPipeline ? 2 : 3
    return bucket ? num - 1 : num
  }, [isInPipeline, bucket])

  const breadcrumbs = useMemo(() => {
    const prefixToDisplay = prefix.slice(0, displayBreadcrumbNum - 1)
    const collapsedBreadcrumbs = prefix.slice(displayBreadcrumbNum - 1, prefix.length - 1)
    return {
      original: prefix,
      needCollapsed: prefix.length > displayBreadcrumbNum,
      prefixBreadcrumbs: prefixToDisplay,
      collapsedBreadcrumbs,
      lastBreadcrumb: prefix[prefix.length - 1],
    }
  }, [displayBreadcrumbNum, prefix])

  const handleBackToBucketList = useCallback(() => {
    setFileList([])
    setSelectedFileList([])
    setBucket('')
    setPrefix([])
  }, [setBucket, setFileList, setPrefix, setSelectedFileList])

  const handleClickBucketName = useCallback(() => {
    setFileList([])
    setSelectedFileList([])
    setPrefix([])
  }, [setFileList, setPrefix, setSelectedFileList])

  const handleClickBreadcrumb = useCallback((index: number) => {
    const newPrefix = prefix.slice(0, index - 1)
    setFileList([])
    setSelectedFileList([])
    setPrefix(newPrefix)
  }, [prefix, setFileList, setPrefix, setSelectedFileList])

  return (
    <div className='flex grow items-center py-1'>
      {showSearchResult && (
        <div className='system-sm-medium text-test-secondary px-[5px] py-1'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.searchResult', {
            searchResultsLength,
            folderName: prefix.length > 0 ? prefix[prefix.length - 1] : bucket,
          })}
        </div>
      )}
      {!showSearchResult && isRoot && (
        <div className='system-sm-medium text-test-secondary px-[5px] py-1'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')}
        </div>
      )}
      {!showSearchResult && !isRoot && (
        <div className='flex items-center gap-x-0.5'>
          {bucket && (
            <Bucket
              bucketName={bucket}
              handleBackToBucketList={handleBackToBucketList}
              handleClickBucketName={handleClickBucketName}
              isActive={prefix.length === 0}
              disabled={prefix.length === 0}
              showSeparator={prefix.length > 0}
            />
          )}
          {!breadcrumbs.needCollapsed && (
            <>
              {breadcrumbs.original.map((breadcrumb, index) => {
                const isLast = index === breadcrumbs.original.length - 1
                return (
                  <BreadcrumbItem
                    key={`${breadcrumb}-${index}`}
                    index={index}
                    handleClick={handleClickBreadcrumb}
                    name={breadcrumb}
                    isActive={isLast}
                    showSeparator={!isLast}
                    disabled={isLast}
                  />
                )
              })}
            </>
          )}
          {breadcrumbs.needCollapsed && (
            <>
              {breadcrumbs.prefixBreadcrumbs.map((breadcrumb, index) => {
                return (
                  <BreadcrumbItem
                    key={`${breadcrumb}-${index}`}
                    index={index}
                    handleClick={handleClickBreadcrumb}
                    name={breadcrumb}
                  />
                )
              })}
              <Dropdown
                startIndex={breadcrumbs.prefixBreadcrumbs.length}
                breadcrumbs={breadcrumbs.collapsedBreadcrumbs}
                onBreadcrumbClick={handleClickBreadcrumb}
              />
              <BreadcrumbItem
                index={prefix.length - 1}
                handleClick={handleClickBreadcrumb}
                name={breadcrumbs.lastBreadcrumb}
                isActive={true}
                disabled={true}
                showSeparator={false}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default React.memo(Breadcrumbs)
