import type { BuiltInMetadataItem, MetadataBatchEditToServer, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import type { DocumentDetailResponse } from '@/models/datasets'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  batchUpdateDocumentMetadata,
  createDatasetMetadata,
  deleteDatasetMetadata,
  fetchBuiltInMetadataFields,
  fetchDatasetMetadata,
  fetchDocumentMetadata,
  updateBuiltInMetadataStatus,
  updateDatasetMetadataName,
} from '../datasets'
import { useInvalid } from '../use-base'
import { useDocumentListKey, useInvalidDocumentList } from './use-document'

const NAME_SPACE = 'dataset-metadata'

export const useDatasetMetaData = (datasetId: string) => {
  return useQuery<{ doc_metadata: MetadataItemWithValueLength[], built_in_field_enabled: boolean }>({
    queryKey: [NAME_SPACE, 'dataset', datasetId],
    queryFn: () => {
      return fetchDatasetMetadata(datasetId)
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
      await createDatasetMetadata(datasetId, payload)
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}
export const useInvalidAllDocumentMetaData = (datasetId: string) => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'document', datasetId],
      exact: false, // invalidate all document metadata: [NAME_SPACE, 'document', datasetId, documentId]
    })
  }
}

const useInvalidAllMetaData = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  const invalidDocumentList = useInvalidDocumentList(datasetId)
  const invalidateAllDocumentMetaData = useInvalidAllDocumentMetaData(datasetId)

  return async () => {
    // meta data in dataset
    await invalidDatasetMetaData()
    // meta data in document list
    invalidDocumentList()
    // meta data in single document
    await invalidateAllDocumentMetaData() // meta data in document
  }
}

export const useRenameMeta = (datasetId: string) => {
  const invalidateAllMetaData = useInvalidAllMetaData(datasetId)
  return useMutation({
    mutationFn: async (payload: MetadataItemWithValueLength) => {
      await updateDatasetMetadataName(datasetId, payload.id, payload.name)
      await invalidateAllMetaData()
    },
  })
}

export const useDeleteMetaData = (datasetId: string) => {
  const invalidateAllMetaData = useInvalidAllMetaData(datasetId)
  return useMutation({
    mutationFn: async (metaDataId: string) => {
      // datasetMetaData = datasetMetaData.filter(item => item.id !== metaDataId)
      await deleteDatasetMetadata(datasetId, metaDataId)
      await invalidateAllMetaData()
    },
  })
}

export const useBuiltInMetaDataFields = () => {
  return useQuery<{ fields: BuiltInMetadataItem[] }>({
    queryKey: [NAME_SPACE, 'built-in'],
    queryFn: () => {
      return fetchBuiltInMetadataFields()
    },
  })
}

export const useDocumentMetaData = ({ datasetId, documentId }: { datasetId: string, documentId: string }) => {
  return useQuery<DocumentDetailResponse>({
    queryKey: [NAME_SPACE, 'document', datasetId, documentId],
    queryFn: () => {
      return fetchDocumentMetadata(datasetId, documentId)
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
      await batchUpdateDocumentMetadata(payload.dataset_id, payload.metadata_list)
      // meta data in dataset
      await queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'dataset', payload.dataset_id],
      })
      // meta data in document list
      await queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'document', payload.dataset_id],
      })
      await queryClient.invalidateQueries({
        queryKey: [...useDocumentListKey, payload.dataset_id],
      })

      // meta data in single document
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
      await updateBuiltInMetadataStatus(datasetId, enabled)
      invalidDatasetMetaData()
    },
  })
}
