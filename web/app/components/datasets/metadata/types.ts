import type {
  DatasetMetadataBuiltInFieldResponse,
  DatasetMetadataListItemResponse,
  DatasetMetadataResponse,
  DatasetMetadataType,
  DocumentMetadataResponse,
  MetadataOperationData,
} from '@dify/contracts/api/console/datasets/types.gen'

export const DataType = {
  string: 'string',
  number: 'number',
  time: 'time',
} as const

export type DataType = DatasetMetadataType

export type BuiltInMetadataItem = DatasetMetadataBuiltInFieldResponse

export type MetadataItem = DatasetMetadataResponse

export type MetadataItemWithValue = DocumentMetadataResponse

export type MetadataItemWithValueLength = DatasetMetadataListItemResponse

export type MetadataItemInBatchEdit = MetadataItemWithValue & {
  isMultipleValue?: boolean
}

export type MetadataBatchEditToServer = MetadataOperationData['operation_data']

export const UpdateType = {
  changeValue: 'changeValue',
  delete: 'delete',
} as const

export type UpdateType = (typeof UpdateType)[keyof typeof UpdateType]

export type MetadataItemWithEdit = MetadataItemWithValue & {
  isMultipleValue?: boolean
  isUpdated?: boolean
  updateType?: UpdateType
}

export const isShowManageMetadataLocalStorageKey = 'dify-isShowManageMetadata'
