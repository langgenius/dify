import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../../../../store'
import Bucket from './bucket'
import BreadcrumbItem from './item'
import Dropdown from './dropdown'
import Drive from './drive'

type BreadcrumbsProps = {
  breadcrumbs: string[]
  keywords: string
  bucket: string
  searchResultsLength: number
  isInPipeline: boolean
}

const Breadcrumbs = ({
  breadcrumbs,
  keywords,
  bucket,
  searchResultsLength,
  isInPipeline,
}: BreadcrumbsProps) => {
  const { t } = useTranslation()
  const dataSourceStore = useDataSourceStore()
  const hasBucket = useDataSourceStoreWithSelector(s => s.hasBucket)
  const showSearchResult = !!keywords && searchResultsLength > 0
  const showBucketListTitle = breadcrumbs.length === 0 && hasBucket && bucket === ''

  const displayBreadcrumbNum = useMemo(() => {
    const num = isInPipeline ? 2 : 3
    return bucket ? num - 1 : num
  }, [isInPipeline, bucket])

  const breadcrumbsConfig = useMemo(() => {
    const prefixToDisplay = breadcrumbs.slice(0, displayBreadcrumbNum - 1)
    const collapsedBreadcrumbs = breadcrumbs.slice(displayBreadcrumbNum - 1, breadcrumbs.length - 1)
    return {
      original: breadcrumbs,
      needCollapsed: breadcrumbs.length > displayBreadcrumbNum,
      prefixBreadcrumbs: prefixToDisplay,
      collapsedBreadcrumbs,
      lastBreadcrumb: breadcrumbs[breadcrumbs.length - 1],
    }
  }, [displayBreadcrumbNum, breadcrumbs])

  const handleBackToBucketList = useCallback(() => {
    const { setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix, setBucket } = dataSourceStore.getState()
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBucket('')
    setBreadcrumbs([])
    setPrefix([])
  }, [dataSourceStore])

  const handleClickBucketName = useCallback(() => {
    const { setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix } = dataSourceStore.getState()
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBreadcrumbs([])
    setPrefix([])
  }, [dataSourceStore])

  const handleBackToRoot = useCallback(() => {
    const { setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix } = dataSourceStore.getState()
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBreadcrumbs([])
    setPrefix([])
  }, [dataSourceStore])

  const handleClickBreadcrumb = useCallback((index: number) => {
    const { breadcrumbs, prefix, setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix } = dataSourceStore.getState()
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1)
    const newPrefix = prefix.slice(0, index + 1)
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBreadcrumbs(newBreadcrumbs)
    setPrefix(newPrefix)
  }, [dataSourceStore])

  return (
    <div className='flex grow items-center overflow-hidden'>
      {showSearchResult && (
        <div className='system-sm-medium text-test-secondary px-[5px]'>
          {t('datasetPipeline.onlineDrive.breadcrumbs.searchResult', {
            searchResultsLength,
            folderName: breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : bucket,
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
              isActive={breadcrumbs.length === 0}
              disabled={breadcrumbs.length === 0}
              showSeparator={breadcrumbs.length > 0}
            />
          )}
          {!hasBucket && (
            <Drive
              breadcrumbs={breadcrumbs}
              handleBackToRoot={handleBackToRoot}
            />
          )}
          {!breadcrumbsConfig.needCollapsed && (
            <>
              {breadcrumbsConfig.original.map((breadcrumb, index) => {
                const isLast = index === breadcrumbsConfig.original.length - 1
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
          {breadcrumbsConfig.needCollapsed && (
            <>
              {breadcrumbsConfig.prefixBreadcrumbs.map((breadcrumb, index) => {
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
                startIndex={breadcrumbsConfig.prefixBreadcrumbs.length}
                breadcrumbs={breadcrumbsConfig.collapsedBreadcrumbs}
                onBreadcrumbClick={handleClickBreadcrumb}
              />
              <BreadcrumbItem
                index={breadcrumbs.length - 1}
                handleClick={handleClickBreadcrumb}
                name={breadcrumbsConfig.lastBreadcrumb}
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
