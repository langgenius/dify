'use client'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetList, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import DatasetCard from './dataset-card'
import DatasetCardSkeleton from './dataset-card-skeleton'
import NewDatasetCard from './new-dataset-card'

type Props = Readonly<{
  tags: string[]
  keywords: string
  includeAll: boolean
  onOpenTagManagement?: () => void
}>

const Datasets = ({
  tags,
  keywords,
  includeAll,
  onOpenTagManagement = () => {},
}: Props) => {
  const { t } = useTranslation()
  const isCurrentWorkspaceEditor = useAppContextWithSelector(state => state.isCurrentWorkspaceEditor)
  const {
    data: datasetList,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    isPlaceholderData,
  } = useDatasetList({
    initialPage: 1,
    tag_ids: tags,
    limit: 30,
    include_all: includeAll,
    keyword: keywords,
  })
  const invalidDatasetList = useInvalidDatasetList()
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)
  const pages = datasetList?.pages ?? []
  const datasets = pages.flatMap(({ data }) => data)
  const showDatasetSkeleton = !isFetchingNextPage && (isLoading || (isPlaceholderData && isFetching && datasets.length === 0))

  useEffect(() => {
    document.title = `${t('knowledge', { ns: 'dataset' })} - Dify`
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

  return (
    <>
      <nav className="grid grow grid-cols-1 content-start gap-3 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {isCurrentWorkspaceEditor && <NewDatasetCard />}
        {showDatasetSkeleton
          ? <DatasetCardSkeleton label={t('loading', { ns: 'common' })} />
          : datasets.map(dataset => (
              <DatasetCard key={dataset.id} dataset={dataset} onSuccess={invalidDatasetList} onOpenTagManagement={onOpenTagManagement} />),
            )}
        {isFetchingNextPage && <Loading />}
        <div ref={anchorRef} className="h-0" />
      </nav>
    </>
  )
}

export default Datasets
