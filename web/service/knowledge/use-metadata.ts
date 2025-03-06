import type { BuiltInMetadataItem, MetadataBatchEditToServer, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import { del, get, patch, post } from '../base'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalid } from '../use-base'
import type { DocumentDetailResponse } from '@/models/datasets'

const NAME_SPACE = 'dataset-metadata'

export const useDatasetMetaData = (datasetId: string) => {
  return useQuery<{ doc_metadata: MetadataItemWithValueLength[], built_in_field_enabled: boolean }>({
    queryKey: [NAME_SPACE, 'dataset', datasetId],
    queryFn: () => {
      return get<{ doc_metadata: MetadataItemWithValueLength[], built_in_field_enabled: boolean }>(`/datasets/${datasetId}/metadata`)
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
      await post(`/datasets/${datasetId}/metadata`, {
        body: payload,
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
      await patch(`/datasets/${datasetId}/metadata/${payload.id}`, {
        body: {
          name: payload.name,
        },
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
      return get('/datasets/metadata/built-in')
    },
  })
}

export const useDocumentMetaData = ({ datasetId, documentId }: { datasetId: string, documentId: string }) => {
  return useQuery<DocumentDetailResponse>({
    queryKey: [NAME_SPACE, 'document', datasetId, documentId],
    queryFn: () => {
      return get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params: { metadata: 'only' } })
    },
  })
}

export const useBatchUpdateDocMetadata = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      dataset_id: string
      metadata_list: MetadataBatchEditToServer
    }) => {
      const documentIds = payload.metadata_list.map(item => item.document_id)
      await post(`/datasets/${payload.dataset_id}/documents/metadata`, {
        body: {
          operation_data: payload.metadata_list,
        },
      })
      // invalidate document metadata
      await Promise.all(documentIds.map(documentId => queryClient.invalidateQueries(
        {
          queryKey: [NAME_SPACE, 'document', payload.dataset_id, documentId],
        },
      )))
    },
  })
}

export const useUpdateBuiltInStatus = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      await post(`/datasets/${datasetId}/metadata/built-in/${enabled ? 'enable' : 'disable'}`)
      invalidDatasetMetaData()
    },
  })
}
