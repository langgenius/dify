import type { BuiltInMetadataItem, MetadataBatchEditToServer, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import { del, get, patch, post } from '../base'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'dataset-metadata'

// let datasetMetaData = [
//   {
//     id: '1-ae54c',
//     name: 'Doc type',
//     type: 'string',
//     use_count: 1,
//   },
//   {
//     id: '2-fufex',
//     name: 'Title',
//     type: 'string',
//     use_count: 5,
//   },
// ]

export const useDatasetMetaData = (datasetId: string) => {
  return useQuery<{ data: MetadataItemWithValueLength[] }>({
    queryKey: [NAME_SPACE, 'dataset', datasetId],
    queryFn: () => {
      return get(`/datasets/${datasetId}/metadata`)
      // return {
      //   data: datasetMetaData,
      // } as {
      //   data: MetadataItemWithValueLength[],
      // }
    },
  })
}

export const useInvalidDatasetMetaData = (datasetId: string) => {
  return useInvalid([NAME_SPACE, 'dataset', datasetId])
}

export const useCreateMetaData = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (payload: BuiltInMetadataItem) => {
      // datasetMetaData.push({
      //   id: `${Math.random()}`,
      //   ...payload,
      //   use_count: 0,
      // })
      await post(`/datasets/${datasetId}/metadata`, payload)
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}

export const useRenameMeta = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (payload: MetadataItemWithValueLength) => {
      // datasetMetaData = datasetMetaData.map((item) => {
      //   if (item.id === payload.id)
      //     return payload

      //   return item
      // })
      await patch(`/datasets/${datasetId}/metadata/${payload.id}`, {
        name: payload.name,
        type: payload.type,
      })
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}

export const useDeleteMetaData = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (metaDataId: string) => {
      // datasetMetaData = datasetMetaData.filter(item => item.id !== metaDataId)
      await del(`/datasets/${datasetId}/metadata/${metaDataId}`)
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}

export const useBuiltInMetaDataFields = () => {
  return useQuery<{ fields: BuiltInMetadataItem[] }>({
    queryKey: [NAME_SPACE, 'built-in'],
    queryFn: () => {
      return get('/metadata/built-in')
      // return {
      //   fields: [
      //     {
      //       name: 'OriginalfileNmae',
      //       type: 'string',
      //     },
      //     {
      //       name: 'Title',
      //       type: 'string',
      //     },
      //   ],
      // } as {
      //   fields: BuiltInMetadataItem[],
      // }
    },
  })
}

export const useBatchUpdateDocMetadata = () => {
  return useMutation({
    mutationFn: (payload: {
      dataset_id: string
      metadata_list: MetadataBatchEditToServer
    }) => {
      // /console/api/datasets/{dataset_id}/documents/metadata
      return post(`/datasets/${payload.dataset_id}/documents/metadata`, payload.metadata_list)
    },
  })
}

export const useUpdateBuiltInStatus = (datasetId: string) => {
  return useMutation({
    mutationFn: (enabled: boolean) => {
      return post(`/datasets/${datasetId}/metadata/built-in/${enabled ? 'disable' : 'enable'}`)
    },
  })
}
