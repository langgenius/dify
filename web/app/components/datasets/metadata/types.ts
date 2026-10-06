export const DataType = {
  string: 'string',
  number: 'number',
  time: 'time',
} as const

export type DataType = (typeof DataType)[keyof typeof DataType]

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

export type MetadataBatchEditToServer = {
  document_id: string
  metadata_list: MetadataItemWithValue[]
  partial_update?: boolean
}[]

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
