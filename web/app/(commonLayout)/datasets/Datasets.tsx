'use client'

import { useCallback, useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import { debounce } from 'lodash-es'
import NewDatasetCard from './NewDatasetCard'
import DatasetCard from './DatasetCard'
import type { DataSetListResponse, FetchDatasetsParams } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import { useAppContext } from '@/context/app-context'
import { useTranslation } from 'react-i18next'

const getKey = (
  pageIndex: number,
  previousPageData: DataSetListResponse,
  tags: string[],
  keyword: string,
  includeAll: boolean,
) => {
  if (!pageIndex || previousPageData.has_more) {
    const params: FetchDatasetsParams = {
      url: 'datasets',
      params: {
        page: pageIndex + 1,
        limit: 30,
        include_all: includeAll,
      },
    }
    if (tags.length)
      params.params.tag_ids = tags
    if (keyword)
      params.params.keyword = keyword
    return params
  }
  return null
}

type Props = {
  containerRef: React.RefObject<HTMLDivElement>
  tags: string[]
  keywords: string
  includeAll: boolean
}

const Datasets = ({
  containerRef,
  tags,
  keywords,
  includeAll,
}: Props) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { data, isLoading, setSize, mutate } = useSWRInfinite(
    (pageIndex: number, previousPageData: DataSetListResponse) => getKey(pageIndex, previousPageData, tags, keywords, includeAll),
    fetchDatasets,
    { revalidateFirstPage: false, revalidateAll: true },
  )
  const loadingStateRef = useRef(false)
  const anchorRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    loadingStateRef.current = isLoading
  }, [isLoading, t])

  const onScroll = useCallback(
    debounce(() => {
      if (!loadingStateRef.current && containerRef.current && anchorRef.current) {
        const { scrollTop, clientHeight } = containerRef.current
        const anchorOffset = anchorRef.current.offsetTop
        if (anchorOffset - scrollTop - clientHeight < 100)
          setSize(size => size + 1)
      }
    }, 50),
    [setSize],
  )

  useEffect(() => {
    const currentContainer = containerRef.current
    currentContainer?.addEventListener('scroll', onScroll)
    return () => {
      currentContainer?.removeEventListener('scroll', onScroll)
      onScroll.cancel()
    }
  }, [onScroll])

  return (
    <nav className='grid shrink-0 grow grid-cols-1 content-start gap-4 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
      {isCurrentWorkspaceEditor && <NewDatasetCard ref={anchorRef} />}
      {data?.map(({ data: datasets }) => datasets.map(dataset => (
        <DatasetCard key={dataset.id} dataset={dataset} onSuccess={mutate} />),
      ))}
    </nav>
  )
}

export default Datasets
