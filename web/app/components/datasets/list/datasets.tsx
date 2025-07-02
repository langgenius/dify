'use client'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import NewDatasetCard from './new-dataset-card'
import DatasetCard from './dataset-card'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetList, useResetDatasetList } from '@/service/knowledge/use-dataset'

type Props = {
  containerRef: React.RefObject<HTMLDivElement>
  tags: string[]
  keywords: string
  includeAll: boolean
}

const Datasets = ({
  tags,
  keywords,
  includeAll,
}: Props) => {
  const { t } = useTranslation()
  const isCurrentWorkspaceEditor = useAppContextWithSelector(state => state.isCurrentWorkspaceEditor)
  const {
    data: datasetList,
    fetchNextPage,
    hasNextPage,
    isFetching,
  } = useDatasetList({
    initialPage: 1,
    tag_ids: tags,
    limit: 30,
    include_all: includeAll,
    keyword: keywords,
  })
  const resetDatasetList = useResetDatasetList()
  const loadingStateRef = useRef(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>()

  useEffect(() => {
    loadingStateRef.current = isFetching
    document.title = `${t('dataset.knowledge')} - Dify`
  }, [isFetching, t])

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage)
          fetchNextPage()
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, datasetList, hasNextPage, fetchNextPage])

  return (
    <>
      <nav className='grid shrink-0 grow grid-cols-1 content-start gap-3 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
        {isCurrentWorkspaceEditor && <NewDatasetCard />}
        {datasetList?.pages.map(({ data: datasets }) => datasets.map(dataset => (
          <DatasetCard key={dataset.id} dataset={dataset} onSuccess={resetDatasetList} />),
        ))}
      </nav>
      <div ref={anchorRef} className='h-0' />
    </>
  )
}

export default Datasets
