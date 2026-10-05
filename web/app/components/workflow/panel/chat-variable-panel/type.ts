export const ChatVarType = {
  Number: 'number',
  String: 'string',
  Boolean: 'boolean',
  Object: 'object',
  ArrayString: 'array[string]',
  ArrayNumber: 'array[number]',
  ArrayBoolean: 'array[boolean]',
  ArrayObject: 'array[object]',
} as const

export type ChatVarType = (typeof ChatVarType)[keyof typeof ChatVarType]
