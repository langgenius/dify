import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../../../../store'
import Bucket from './bucket'
import BreadcrumbItem from './item'
import Dropdown from './dropdown'
import Drive from './drive'

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
  const dataSourceStore = useDataSourceStore()
  const hasBucket = useDataSourceStoreWithSelector(s => s.hasBucket)
  const showSearchResult = !!keywords && searchResultsLength > 0
  const showBucketListTitle = prefix.length === 0 && hasBucket && bucket === ''

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
    const { setFileList, setSelectedFileIds, setPrefix, setBucket } = dataSourceStore.getState()
    setFileList([])
    setSelectedFileIds([])
    setBucket('')
    setPrefix([])
  }, [dataSourceStore])

  const handleClickBucketName = useCallback(() => {
    const { setFileList, setSelectedFileIds, setPrefix } = dataSourceStore.getState()
    setFileList([])
    setSelectedFileIds([])
    setPrefix([])
  }, [dataSourceStore])

  const handleBackToRoot = useCallback(() => {
    const { setFileList, setSelectedFileIds, setPrefix } = dataSourceStore.getState()
    setFileList([])
    setSelectedFileIds([])
    setPrefix([])
  }, [dataSourceStore])

  const handleClickBreadcrumb = useCallback((index: number) => {
    const { prefix, setFileList, setSelectedFileIds, setPrefix } = dataSourceStore.getState()
    const newPrefix = prefix.slice(0, index + 1)
    setFileList([])
    setSelectedFileIds([])
    setPrefix(newPrefix)
  }, [dataSourceStore])

  return (
    <div className='flex grow items-center overflow-hidden'>
      {showSearchResult && (
        <div className='system-sm-medium text-test-secondary px-[5px]'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.searchResult', {
            searchResultsLength,
            folderName: prefix.length > 0 ? prefix[prefix.length - 1] : bucket,
          })}
        </div>
      )}
      {!showSearchResult && showBucketListTitle && (
        <div className='system-sm-medium text-test-secondary px-[5px]'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')}
        </div>
      )}
      {!showSearchResult && !showBucketListTitle && (
        <div className='flex w-full items-center gap-x-0.5 overflow-hidden'>
          {hasBucket && bucket && (
            <Bucket
              bucketName={bucket}
              handleBackToBucketList={handleBackToBucketList}
              handleClickBucketName={handleClickBucketName}
              isActive={prefix.length === 0}
              disabled={prefix.length === 0}
              showSeparator={prefix.length > 0}
            />
          )}
          {!hasBucket && (
            <Drive
              prefix={prefix}
              handleBackToRoot={handleBackToRoot}
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
