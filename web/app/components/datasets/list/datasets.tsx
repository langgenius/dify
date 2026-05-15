'use client'

import type { ReactNode } from 'react'
import type { useDatasetList } from '@/service/knowledge/use-dataset'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import DatasetCard from './dataset-card'
import NewDatasetCard from './new-dataset-card'

type Props = {
  datasetList: ReturnType<typeof useDatasetList>['data'] | null
  fetchNextPage: ReturnType<typeof useDatasetList>['fetchNextPage']
  hasNextPage: ReturnType<typeof useDatasetList>['hasNextPage']
  isFetching: ReturnType<typeof useDatasetList>['isFetching']
  isFetchingNextPage: ReturnType<typeof useDatasetList>['isFetchingNextPage']
  emptyElement?: ReactNode
  onOpenTagManagement?: () => void
}

const Datasets = ({
  datasetList,
  fetchNextPage,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  emptyElement,
  onOpenTagManagement = () => {},
}: Props) => {
  const { t } = useTranslation()
  const isCurrentWorkspaceEditor = useAppContextWithSelector(state => state.isCurrentWorkspaceEditor)
  const invalidDatasetList = useInvalidDatasetList()
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)

  useEffect(() => {
    document.title = `${t('knowledge', { ns: 'dataset' })} - Dify`
  }, [t])

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && hasNextPage && !isFetching)
          fetchNextPage()
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, hasNextPage, isFetching, fetchNextPage])

  const hasAnyDataset = (datasetList?.pages[0]?.total ?? 0) > 0 || !!datasetList?.pages.some(({ data }) => data.length > 0)

  return (
    <>
      <nav className="relative grid grow grid-cols-[repeat(auto-fill,minmax(296px,1fr))] content-start gap-3 px-6 pt-2">
        {isCurrentWorkspaceEditor && hasAnyDataset && <NewDatasetCard />}
        {datasetList?.pages.map(({ data: datasets }) => datasets.map(dataset => (
          <DatasetCard key={dataset.id} dataset={dataset} onSuccess={invalidDatasetList} onOpenTagManagement={onOpenTagManagement} />),
        ))}
        {!hasAnyDataset && emptyElement}
        {isFetchingNextPage && <Loading />}
        <div ref={anchorRef} className="h-0" />
      </nav>
    </>
  )
}

export default Datasets
