'use client'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import NewDatasetCard from './new-dataset-card'
import DatasetCard from './dataset-card'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetList, useInvalidDatasetList } from '@/service/knowledge/use-dataset'

type Props = {
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
  const invalidDatasetList = useInvalidDatasetList()
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)

  useEffect(() => {
    document.title = `${t('dataset.knowledge')} - Dify`
  }, [t])

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetching)
          fetchNextPage()
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, hasNextPage, isFetching, fetchNextPage])

  return (
    <>
      <nav className='grid grow grid-cols-1 content-start gap-3 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
        {isCurrentWorkspaceEditor && <NewDatasetCard />}
        {datasetList?.pages.map(({ data: datasets }) => datasets.map(dataset => (
          <DatasetCard key={dataset.id} dataset={dataset} onSuccess={invalidDatasetList} />),
        ))}
        <div ref={anchorRef} className='h-0' />
      </nav>
    </>
  )
}

export default Datasets
