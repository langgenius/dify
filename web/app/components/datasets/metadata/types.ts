export enum DataType {
  string = 'string',
  number = 'number',
  time = 'time',
}

export type MetadataItem = {
  id: string
  type: DataType
  name: string
}

export type MetadataItemWithValue = MetadataItem & {
  value: string | number
}

export type MetadataItemWithValueLength = MetadataItem & {
  valueLength: number
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
