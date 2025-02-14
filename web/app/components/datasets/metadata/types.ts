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

export type MetadataItemWithValueLength = MetadataItem & {
  valueLength: number
}

export type MetadataItemWithEdit = MetadataItem & {
  value: string
  isMultipleValue?: boolean
  isRemoved?: boolean
  isUpdated?: boolean
}
