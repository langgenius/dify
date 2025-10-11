export enum DataType {
  string = 'string',
  number = 'number',
  time = 'time',
}

export type BuiltInMetadataItem = {
  type: DataType
  name: string
}

export type MetadataItem = BuiltInMetadataItem & {
  id: string
}

export type MetadataItemWithValue = MetadataItem & {
  value: string | number | null
}

export type MetadataItemWithValueLength = MetadataItem & {
  count: number
}

export type MetadataItemInBatchEdit = MetadataItemWithValue & {
  isMultipleValue?: boolean
}

export type MetadataBatchEditToServer = { document_id: string, metadata_list: MetadataItemWithValue[] }[]

export enum UpdateType {
  changeValue = 'changeValue',
  delete = 'delete',
}

export type MetadataItemWithEdit = MetadataItemWithValue & {
  isMultipleValue?: boolean
  isUpdated?: boolean
  updateType?: UpdateType
}

export const isShowManageMetadataLocalStorageKey = 'dify-isShowManageMetadata'
