import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import { useMutation, useQuery } from '@tanstack/react-query'

const NAME_SPACE = 'dataset-metadata'

export const useDatasetMetaData = (datasetId: string) => {
  return useQuery<{ data: MetadataItemWithValueLength[] }>({
    queryKey: [NAME_SPACE, 'dataset', datasetId],
    queryFn: () => {
      return {
        data: [
          {
            id: '1',
            name: 'Doc type',
            type: 'string',
            valueLength: 1,
          },
          {
            id: '2',
            name: 'Title',
            type: 'string',
            valueLength: 5,
          },
        ],
      } as {
        data: MetadataItemWithValueLength[],
      }
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

// fetch: built_in_field_enabled
export const useUpdateBuiltInStatus = (datasetId: string) => {
  return useMutation({
    mutationFn: (enabled: boolean) => {
      console.log(datasetId, enabled)
      return Promise.resolve(true)
    },
  })
}
