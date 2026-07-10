'use client'

import type { ReactNode } from 'react'
import type { useDatasetList } from '@/service/knowledge/use-dataset'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import DatasetCard from './dataset-card'
import DatasetCardSkeleton from './dataset-card-skeleton'

type Props = Readonly<{
  datasetList: ReturnType<typeof useDatasetList>['data'] | null
  fetchNextPage: ReturnType<typeof useDatasetList>['fetchNextPage']
  hasNextPage: ReturnType<typeof useDatasetList>['hasNextPage']
  isFetching: ReturnType<typeof useDatasetList>['isFetching']
  isFetchingNextPage: ReturnType<typeof useDatasetList>['isFetchingNextPage']
  isLoading: ReturnType<typeof useDatasetList>['isLoading']
  isPlaceholderData: ReturnType<typeof useDatasetList>['isPlaceholderData']
  emptyElement?: ReactNode
  onOpenTagManagement?: () => void
}>

const Datasets = ({
  datasetList,
  fetchNextPage,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  isLoading,
  isPlaceholderData,
  emptyElement,
  onOpenTagManagement = () => { },
}: Props) => {
  const { t } = useTranslation()
  const invalidDatasetList = useInvalidDatasetList()
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)
  const pages = datasetList?.pages ?? []
  const datasets = pages.flatMap(({ data }) => data)
  const showDatasetSkeleton = !isFetchingNextPage && (isLoading || (isPlaceholderData && isFetching && datasets.length === 0))

  useEffect(() => {
    document.title = `${t($ => $.knowledge, { ns: 'dataset' })} - Dify`
  }, [t])

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && hasNextPage && !isFetching && !isPlaceholderData)
          fetchNextPage()
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, hasNextPage, isFetching, isPlaceholderData, fetchNextPage])

  const hasAnyDataset = (datasetList?.pages[0]?.total ?? 0) > 0 || !!datasetList?.pages.some(({ data }) => data.length > 0)

  return (
    <>
      <nav className="relative grid grow grid-cols-[repeat(auto-fill,minmax(296px,1fr))] content-start gap-3 px-8 pt-2">
        {showDatasetSkeleton
          ? <DatasetCardSkeleton label={t($ => $.loading, { ns: 'common' })} />
          : datasets.map(dataset => (
              <DatasetCard key={dataset.id} dataset={dataset} onSuccess={invalidDatasetList} onOpenTagManagement={onOpenTagManagement} />),
            )}
        {!showDatasetSkeleton && !hasAnyDataset && emptyElement}
        {isFetchingNextPage && <Loading />}
        <div ref={anchorRef} className="h-0" />
      </nav>
    </>
  )
}

export default Datasets
