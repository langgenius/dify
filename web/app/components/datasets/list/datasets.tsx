'use client'

import type { DatasetListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import DatasetCard from './dataset-card'
import DatasetCardSkeleton from './dataset-card-skeleton'
import { useInvalidDatasetList } from './use-dataset-list'

const DATASET_GRID_CLASS_NAME =
  'grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] content-start gap-3'

type DatasetListQuery = UseInfiniteQueryResult<InfiniteData<DatasetListResponse, number>>

type Props = Readonly<{
  datasetList: DatasetListQuery['data'] | null
  fetchNextPage: DatasetListQuery['fetchNextPage']
  hasNextPage: DatasetListQuery['hasNextPage']
  isFetching: DatasetListQuery['isFetching']
  isFetchingNextPage: DatasetListQuery['isFetchingNextPage']
  isLoading: DatasetListQuery['isLoading']
  isPlaceholderData: DatasetListQuery['isPlaceholderData']
  emptyElement?: ReactNode
  onOpenTagManagement?: () => void
  stepByStepTourActionMenuHighlightPart?: string
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourCardTarget?: string
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
  onOpenTagManagement = () => {},
  stepByStepTourActionMenuHighlightPart,
  stepByStepTourActionMenuOpen,
  stepByStepTourCardTarget,
}: Props) => {
  const { t } = useTranslation(['common', 'dataset'])
  const invalidDatasetList = useInvalidDatasetList()
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)
  const pages = datasetList?.pages ?? []
  const datasets = pages.flatMap(({ data }) => data)
  const showDatasetSkeleton =
    !isFetchingNextPage && (isLoading || (isPlaceholderData && isFetching && datasets.length === 0))

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]!.isIntersecting && hasNextPage && !isFetching && !isPlaceholderData)
            fetchNextPage()
        },
        {
          rootMargin: '100px',
        },
      )
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, hasNextPage, isFetching, isPlaceholderData, fetchNextPage])

  const hasAnyDataset =
    (datasetList?.pages[0]?.total ?? 0) > 0 ||
    !!datasetList?.pages.some(({ data }) => data.length > 0)

  return (
    <div aria-busy={isFetching} className="relative grow px-8 pt-2">
      {showDatasetSkeleton ? (
        <div role="status" aria-label={t(($) => $.loading, { ns: 'common' })}>
          <ul aria-hidden className={DATASET_GRID_CLASS_NAME}>
            <DatasetCardSkeleton />
          </ul>
        </div>
      ) : (
        datasets.length > 0 && (
          <ul
            // Safari list semantics: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/list-style#accessibility
            // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Dify's preflight removes list markers.
            role="list"
            aria-label={t(($) => $.knowledge, { ns: 'dataset' })}
            className={DATASET_GRID_CLASS_NAME}
          >
            {datasets.map((dataset, index) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                onSuccess={invalidDatasetList}
                onOpenTagManagement={onOpenTagManagement}
                stepByStepTourActionMenuHighlightPart={
                  index === 0 && stepByStepTourActionMenuOpen
                    ? stepByStepTourActionMenuHighlightPart
                    : undefined
                }
                stepByStepTourActionMenuOpen={
                  index === 0 ? stepByStepTourActionMenuOpen : undefined
                }
                stepByStepTourCardTarget={index === 0 ? stepByStepTourCardTarget : undefined}
              />
            ))}
          </ul>
        )
      )}
      {!showDatasetSkeleton && !hasAnyDataset && emptyElement}
      {isFetchingNextPage && <LoadingPlaceholder />}
      <div ref={anchorRef} className="h-0" />
    </div>
  )
}

export default Datasets
