'use client'

import type { DatasetListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import { consoleQuery } from '@/service/console'
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'
import { DeleteDatasetConfirmation } from '../delete-dataset-confirmation'
import DatasetCard from './dataset-card'
import DatasetCardSkeleton from './dataset-card-skeleton'
import { useInvalidDatasetList } from './use-dataset-list'

const DATASET_GRID_CLASS_NAME = cn('content-start gap-2.5', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)

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
  const listRef = useRef<HTMLDivElement>(null)
  const [deleteDialog] = useState(() =>
    createAlertDialogHandle<{
      id: string
      adjacentFocusTargets: HTMLElement[]
      fallbackFocus: { current: HTMLElement | null }
    }>(),
  )
  const deletion = useMutation(
    consoleQuery.datasets.byDatasetId.delete.mutationOptions({ context: { silent: true } }),
  )
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
    <div
      ref={listRef}
      tabIndex={-1}
      role="region"
      aria-label={t(($) => $.knowledge, { ns: 'dataset' })}
      aria-busy={isFetching}
      className="relative grow px-8 pt-2 focus-visible:outline-2 focus-visible:outline-state-accent-solid"
    >
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
                onDelete={(item) =>
                  deleteDialog.openWithPayload({
                    id: dataset.id,
                    adjacentFocusTargets: getAdjacentFocusTargets(item, (sibling) =>
                      sibling.querySelector<HTMLElement>(':scope > a[href], :scope > button'),
                    ),
                    fallbackFocus: { current: null },
                  })
                }
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
      <AlertDialog
        handle={deleteDialog}
        onOpenChange={(open, details) => {
          if (!open && deletion.isPending && details.reason !== 'imperative-action')
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) deletion.reset()
        }}
      >
        {({ payload }) => (
          <AlertDialogContent
            finalFocus={() => {
              const fallback = payload?.fallbackFocus.current
              if (!fallback) return true
              const target =
                payload.adjacentFocusTargets.find((element) => element.isConnected) ?? fallback
              target.focus({ preventScroll: true })
              return false
            }}
          >
            {payload && (
              <DeleteDatasetConfirmation
                datasetId={payload.id}
                isPending={deletion.isPending}
                error={
                  deletion.isError ? t(($) => $['api.actionFailed'], { ns: 'common' }) : undefined
                }
                onConfirm={() => {
                  if (deletion.isPending) return
                  deletion.mutate(
                    { params: { dataset_id: payload.id } },
                    {
                      onSuccess: () => {
                        payload.fallbackFocus.current = listRef.current
                        deleteDialog.close()
                      },
                    },
                  )
                }}
              />
            )}
          </AlertDialogContent>
        )}
      </AlertDialog>
      <div ref={anchorRef} className="h-0" />
    </div>
  )
}

export default Datasets
