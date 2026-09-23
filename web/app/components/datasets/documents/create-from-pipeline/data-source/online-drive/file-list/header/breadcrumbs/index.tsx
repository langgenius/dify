import { Breadcrumb, BreadcrumbList } from '@langgenius/dify-ui/breadcrumb'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../../../../store'
import Bucket from './bucket'
import Drive from './drive'
import Dropdown from './dropdown'
import BreadcrumbItem from './item'

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
  const hasBucket = useDataSourceStoreWithSelector((s) => s.hasBucket)
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
    const { setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix, setBucket } =
      dataSourceStore.getState()
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBucket('')
    setBreadcrumbs([])
    setPrefix([])
  }, [dataSourceStore])

  const handleClickBucketName = useCallback(() => {
    const { setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix } =
      dataSourceStore.getState()
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBreadcrumbs([])
    setPrefix([])
  }, [dataSourceStore])

  const handleBackToRoot = useCallback(() => {
    const { setOnlineDriveFileList, setSelectedFileIds, setBreadcrumbs, setPrefix } =
      dataSourceStore.getState()
    setOnlineDriveFileList([])
    setSelectedFileIds([])
    setBreadcrumbs([])
    setPrefix([])
  }, [dataSourceStore])

  const handleClickBreadcrumb = useCallback(
    (index: number) => {
      const {
        breadcrumbs,
        prefix,
        setOnlineDriveFileList,
        setSelectedFileIds,
        setBreadcrumbs,
        setPrefix,
      } = dataSourceStore.getState()
      const newBreadcrumbs = breadcrumbs.slice(0, index + 1)
      const newPrefix = prefix.slice(0, index + 1)
      setOnlineDriveFileList([])
      setSelectedFileIds([])
      setBreadcrumbs(newBreadcrumbs)
      setPrefix(newPrefix)
    },
    [dataSourceStore],
  )

  return (
    <div className="flex min-w-0 grow items-center">
      {showSearchResult && (
        <div className="px-1.25 system-sm-medium">
          {t(($) => $['onlineDrive.breadcrumbs.searchResult'], {
            ns: 'datasetPipeline',
            searchResultsLength,
            folderName: breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : bucket,
          })}
        </div>
      )}
      {!showSearchResult && showBucketListTitle && (
        <div className="px-1.25 system-sm-medium">
          {t(($) => $['onlineDrive.breadcrumbs.allBuckets'], { ns: 'datasetPipeline' })}
        </div>
      )}
      {!showSearchResult && !showBucketListTitle && (
        <Breadcrumb
          aria-label={t(($) => $['onlineDrive.breadcrumbs.allFiles'], { ns: 'datasetPipeline' })}
          className="w-full"
        >
          <BreadcrumbList className="gap-0.5">
            {hasBucket && bucket && (
              <Bucket
                bucketName={bucket}
                handleBackToBucketList={handleBackToBucketList}
                handleClickBucketName={handleClickBucketName}
                current={breadcrumbs.length === 0}
              />
            )}
            {!hasBucket && <Drive breadcrumbs={breadcrumbs} handleBackToRoot={handleBackToRoot} />}
            {!breadcrumbsConfig.needCollapsed && (
              <>
                {breadcrumbsConfig.original.map((breadcrumb, index) => {
                  const isLast = index === breadcrumbsConfig.original.length - 1
                  return (
                    <BreadcrumbItem
                      key={breadcrumbs.slice(0, index + 1).join('/')}
                      onClick={() => handleClickBreadcrumb(index)}
                      name={breadcrumb}
                      title={breadcrumb}
                      current={isLast}
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
                      key={breadcrumbs.slice(0, index + 1).join('/')}
                      onClick={() => handleClickBreadcrumb(index)}
                      name={breadcrumb}
                      title={breadcrumb}
                    />
                  )
                })}
                <Dropdown
                  startIndex={breadcrumbsConfig.prefixBreadcrumbs.length}
                  breadcrumbs={breadcrumbsConfig.collapsedBreadcrumbs}
                  onBreadcrumbClick={handleClickBreadcrumb}
                />
                <BreadcrumbItem
                  onClick={() => handleClickBreadcrumb(breadcrumbs.length - 1)}
                  name={breadcrumbsConfig.lastBreadcrumb!}
                  title={breadcrumbsConfig.lastBreadcrumb!}
                  current
                />
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      )}
    </div>
  )
}

export default React.memo(Breadcrumbs)
