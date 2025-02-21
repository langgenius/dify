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
  value: string | number
}

export type MetadataItemWithValueLength = MetadataItem & {
  use_count: number
}
export enum UpdateType {
  changeValue = 'changeValue',
  delete = 'delete',
}
export type MetadataItemWithEdit = MetadataItemWithValue & {
  isMultipleValue?: boolean
  isUpdated?: boolean
  updateType?: UpdateType
}
