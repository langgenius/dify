import type {
  BuiltInMetadataItem,
  MetadataBatchEditToServer,
  MetadataItemWithValueLength,
} from '@/app/components/datasets/metadata/types'
import type { DocumentDetailResponse } from '@/models/datasets'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '../console'
import { narrowResponse } from '../console/narrow-response'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'dataset-metadata'

export const useDatasetMetaData = (datasetId: string) => {
  return useQuery<{ doc_metadata: MetadataItemWithValueLength[]; built_in_field_enabled: boolean }>(
    {
      queryKey: [NAME_SPACE, 'dataset', datasetId],
      queryFn: () => {
        return narrowResponse(
          consoleClient.datasets.byDatasetId.metadata.get({ params: { dataset_id: datasetId } }),
        )
      },
    },
  )
}

const useInvalidDatasetMetaData = (datasetId: string) => {
  return useInvalid([NAME_SPACE, 'dataset', datasetId])
}

export const useCreateMetaData = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (payload: BuiltInMetadataItem) => {
      await consoleClient.datasets.byDatasetId.metadata.post({
        params: { dataset_id: datasetId },
        body: payload,
      })
      await invalidDatasetMetaData()
      return Promise.resolve(true)
    },
  })
}
const useInvalidAllDocumentMetaData = (datasetId: string) => {
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
  const queryClient = useQueryClient()
  const invalidDocumentList = () =>
    queryClient.invalidateQueries({
      queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
        input: { params: { dataset_id: datasetId } },
      }),
    })
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
      await consoleClient.datasets.byDatasetId.metadata.byMetadataId.patch({
        params: { dataset_id: datasetId, metadata_id: payload.id },
        body: {
          name: payload.name,
        },
      })
      await invalidateAllMetaData()
    },
  })
}

export const useDeleteMetaData = (datasetId: string) => {
  const invalidateAllMetaData = useInvalidAllMetaData(datasetId)
  return useMutation({
    mutationFn: async (metaDataId: string) => {
      // datasetMetaData = datasetMetaData.filter(item => item.id !== metaDataId)
      await consoleClient.datasets.byDatasetId.metadata.byMetadataId.delete({
        params: { dataset_id: datasetId, metadata_id: metaDataId },
      })
      await invalidateAllMetaData()
    },
  })
}

export const useBuiltInMetaDataFields = () => {
  return useQuery<{ fields: BuiltInMetadataItem[] }>({
    queryKey: [NAME_SPACE, 'built-in'],
    queryFn: () => {
      return narrowResponse(consoleClient.datasets.metadata.builtIn.get())
    },
  })
}

export const useDocumentMetaData = ({
  datasetId,
  documentId,
}: {
  datasetId: string
  documentId: string
}) => {
  return useQuery<DocumentDetailResponse>({
    queryKey: [NAME_SPACE, 'document', datasetId, documentId],
    queryFn: () => {
      return narrowResponse(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.get({
          params: { dataset_id: datasetId, document_id: documentId },
          query: { metadata: 'only' },
        }),
      )
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
      const documentIds = payload.metadata_list.map((item) => item.document_id)
      await consoleClient.datasets.byDatasetId.documents.metadata.post({
        params: { dataset_id: payload.dataset_id },
        body: {
          operation_data: payload.metadata_list,
        },
      })
      // meta data in dataset
      await queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'dataset', payload.dataset_id],
      })
      // meta data in document list
      await queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'document', payload.dataset_id],
      })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
          input: { params: { dataset_id: payload.dataset_id } },
        }),
      })

      // meta data in single document
      await Promise.all(
        documentIds.map((documentId) =>
          queryClient.invalidateQueries({
            queryKey: [NAME_SPACE, 'document', payload.dataset_id, documentId],
          }),
        ),
      )
    },
  })
}

export const useUpdateBuiltInStatus = (datasetId: string) => {
  const invalidDatasetMetaData = useInvalidDatasetMetaData(datasetId)
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      await consoleClient.datasets.byDatasetId.metadata.builtIn.byAction.post({
        params: { dataset_id: datasetId, action: enabled ? 'enable' : 'disable' },
      })
      invalidDatasetMetaData()
    },
  })
}
