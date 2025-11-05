export enum ChatVarType {
  Number = 'number',
  String = 'string',
  Boolean = 'boolean',
  Object = 'object',
  ArrayString = 'array[string]',
  ArrayNumber = 'array[number]',
  ArrayBoolean = 'array[boolean]',
  ArrayObject = 'array[object]',
  Memory = 'memory_block',
}

export type ObjectValueItem = {
  key: string
  type: ChatVarType
  value: string | number | undefined
}
