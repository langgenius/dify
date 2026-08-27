'use client'

import type { ReactNode, RefObject } from 'react'
import type { useDatasetList } from '@/service/knowledge/use-dataset'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { VirtualizedCardGrid } from '@/app/components/base/virtualized-card-grid'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import DatasetCard from './dataset-card'
import DatasetCardSkeleton from './dataset-card-skeleton'

const DATASET_LIST_GRID_COLUMNS_CLASS_NAME =
  'grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-3'
/** Mirrors the `h-41.5` height DatasetCard renders at. */
const DATASET_CARD_HEIGHT = 166

type Props = Readonly<{
  datasetList: ReturnType<typeof useDatasetList>['data'] | null
  fetchNextPage: ReturnType<typeof useDatasetList>['fetchNextPage']
  hasNextPage: ReturnType<typeof useDatasetList>['hasNextPage']
  isFetching: ReturnType<typeof useDatasetList>['isFetching']
  isFetchingNextPage: ReturnType<typeof useDatasetList>['isFetchingNextPage']
  isLoading: ReturnType<typeof useDatasetList>['isLoading']
  isPlaceholderData: ReturnType<typeof useDatasetList>['isPlaceholderData']
  scrollContainerRef: RefObject<Element | null>
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
  scrollContainerRef,
  emptyElement,
  onOpenTagManagement = () => {},
  stepByStepTourActionMenuHighlightPart,
  stepByStepTourActionMenuOpen,
  stepByStepTourCardTarget,
}: Props) => {
  const { t } = useTranslation()
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
    <>
      <nav className="relative grow px-8 pt-2">
        {showDatasetSkeleton ? (
          <div className={DATASET_LIST_GRID_COLUMNS_CLASS_NAME}>
            <DatasetCardSkeleton label={t(($) => $.loading, { ns: 'common' })} />
          </div>
        ) : (
          <VirtualizedCardGrid
            className={cn('content-start', DATASET_LIST_GRID_COLUMNS_CLASS_NAME)}
            getItemKey={(dataset) => dataset.id}
            items={datasets}
            renderItem={(dataset, index) => (
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
            )}
            rowHeight={DATASET_CARD_HEIGHT}
            scrollContainerRef={scrollContainerRef}
          />
        )}
        {!showDatasetSkeleton && !hasAnyDataset && emptyElement}
        {isFetchingNextPage && <Loading />}
        <div ref={anchorRef} className="h-0" />
      </nav>
    </>
  )
}

export default Datasets
