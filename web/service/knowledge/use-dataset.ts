import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { DataSet, DataSetListResponse, DatasetListRequest, RelatedAppResponse } from '@/models/datasets'
import { get } from '../base'
import { useReset } from '../use-base'
import qs from 'qs'

const NAME_SPACE = 'dataset'

const DatasetListKey = [NAME_SPACE, 'list']

export const useDatasetList = (params: DatasetListRequest) => {
  const { initialPage, tag_ids, limit, include_all, keyword } = params
  return useInfiniteQuery({
    queryKey: [...DatasetListKey, initialPage, tag_ids, limit, include_all, keyword],
    queryFn: ({ pageParam = 1 }) => {
      const urlParams = qs.stringify({
        tag_ids,
        limit,
        include_all,
        keyword,
        page: pageParam,
      }, { indices: false })
      return get<DataSetListResponse>(`/datasets?${urlParams}`)
    },
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : null,
    initialPageParam: initialPage,
  })
}

export const useResetDatasetList = () => {
  return useReset([...DatasetListKey])
}

export const useDatasetDetail = (datasetId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'detail', datasetId],
    queryFn: () => get<DataSet>(`/datasets/${datasetId}`),
  })
}

export const useDatasetRelatedApps = (datasetId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'related-apps', datasetId],
    queryFn: () => get<RelatedAppResponse>(`/datasets/${datasetId}/related_apps`),
  })
}
