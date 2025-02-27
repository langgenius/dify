import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'dataset-metadata'

let datasetMetaData = [
  {
    id: '1-ae54c',
    name: 'Doc type',
    type: 'string',
    use_count: 1,
  },
  {
    id: '2-fufex',
    name: 'Title',
    type: 'string',
    use_count: 5,
  },
]

export const useDatasetMetaData = (datasetId: string) => {
  return useQuery<{ data: MetadataItemWithValueLength[] }>({
    queryKey: [NAME_SPACE, 'dataset', datasetId],
    queryFn: () => {
      return {
        data: datasetMetaData,
      } as {
        data: MetadataItemWithValueLength[],
      }
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
      datasetMetaData.push({
        id: `${Math.random()}`,
        ...payload,
        use_count: 0,
      })
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}

export const useRenameMeta = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (payload: MetadataItemWithValueLength) => {
      datasetMetaData = datasetMetaData.map((item) => {
        if (item.id === payload.id)
          return payload

        return item
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
      datasetMetaData = datasetMetaData.filter(item => item.id !== metaDataId)
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}

export const useBuiltInMetaData = () => {
  return useQuery<{ fields: BuiltInMetadataItem[] }>({
    queryKey: [NAME_SPACE, 'built-in'],
    queryFn: () => {
      return {
        fields: [
          {
            name: 'OriginalfileNmae',
            type: 'string',
          },
          {
            name: 'Title',
            type: 'string',
          },
        ],
      } as {
        fields: BuiltInMetadataItem[],
      }
    },
  })
}

export const useBatchUpdateDocMetadata = (datasetId: string) => {
  return useMutation({
    mutationFn: (enabled: boolean) => {
      console.log(datasetId, enabled)
      return Promise.resolve(true)
    },
  })
}

export const useUpdateBuiltInStatus = (datasetId: string) => {
  return useMutation({
    mutationFn: (enabled: boolean) => {
      console.log(datasetId, enabled)
      return Promise.resolve(true)
    },
  })
}
