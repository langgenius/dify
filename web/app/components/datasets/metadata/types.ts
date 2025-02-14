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
