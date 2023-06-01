'use client'

import { useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import { debounce } from 'lodash-es'
import NewDatasetCard from './NewDatasetCard'
import DatasetCard from './DatasetCard'
import type { DataSetListResponse } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import { useSelector } from '@/context/app-context'

const getKey = (pageIndex: number, previousPageData: DataSetListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'datasets', params: { page: pageIndex + 1, limit: 30 } }
  return null
}

const Datasets = () => {
  const { data, isLoading, setSize, mutate } = useSWRInfinite(getKey, fetchDatasets, { revalidateFirstPage: false })
  const loadingStateRef = useRef(false)
  const pageContainerRef = useSelector(state => state.pageContainerRef)
  const anchorRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    loadingStateRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    const onScroll = debounce(() => {
      if (!loadingStateRef.current) {
        const { scrollTop, clientHeight } = pageContainerRef.current!
        const anchorOffset = anchorRef.current!.offsetTop
        if (anchorOffset - scrollTop - clientHeight < 100)
          setSize(size => size + 1)
      }
    }, 50)

    pageContainerRef.current?.addEventListener('scroll', onScroll)
    return () => pageContainerRef.current?.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className='grid content-start grid-cols-1 gap-4 px-12 pt-8 sm:grid-cols-2 lg:grid-cols-4 grow shrink-0'>
      {data?.map(({ data: datasets }) => datasets.map(dataset => (
        <DatasetCard key={dataset.id} dataset={dataset} onDelete={mutate} />),
      ))}
      <NewDatasetCard ref={anchorRef} />
    </nav>
  )
}

export default Datasets
