'use client'

import { useEffect, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import { debounce } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import NewDatasetCard from './NewDatasetCard'
import DatasetCard from './DatasetCard'
import type { DataSetListResponse, FetchDatasetsParams } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import { useAppContext } from '@/context/app-context'

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
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { data, isLoading, setSize, mutate } = useSWRInfinite(
    (pageIndex: number, previousPageData: DataSetListResponse) => getKey(pageIndex, previousPageData, tags, keywords, includeAll),
    fetchDatasets,
    { revalidateFirstPage: false, revalidateAll: true },
  )
  const loadingStateRef = useRef(false)
  const anchorRef = useRef<HTMLAnchorElement>(null)

  const { t } = useTranslation()

  useEffect(() => {
    loadingStateRef.current = isLoading
    document.title = `${t('dataset.knowledge')} - Dify`
  }, [isLoading])

  useEffect(() => {
    const onScroll = debounce(() => {
      if (!loadingStateRef.current) {
        const { scrollTop, clientHeight } = containerRef.current!
        const anchorOffset = anchorRef.current!.offsetTop
        if (anchorOffset - scrollTop - clientHeight < 100)
          setSize(size => size + 1)
      }
    }, 50)

    containerRef.current?.addEventListener('scroll', onScroll)
    return () => containerRef.current?.removeEventListener('scroll', onScroll)
  }, [])

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
