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

const chatVarTypes = new Set<string>(Object.values(ChatVarType))

export const isChatVarType = (value: string): value is ChatVarType => chatVarTypes.has(value)
