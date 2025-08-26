export enum ChatVarType {
  Number = 'number',
  String = 'string',
  Object = 'object',
  ArrayString = 'array[string]',
  ArrayNumber = 'array[number]',
  ArrayObject = 'array[object]',
  Memory = 'memory',
}

export type ObjectValueItem = {
  key: string
  type: ChatVarType
  value: string | number | undefined
}
