export const ChatVarType = {
  Number: 'number',
  String: 'string',
  Boolean: 'boolean',
  Object: 'object',
  ArrayString: 'array[string]',
  ArrayNumber: 'array[number]',
  ArrayBoolean: 'array[boolean]',
  ArrayObject: 'array[object]',
  // Created outside the variable panel (DSL import, API); the panel only displays it.
  Secret: 'secret',
} as const

export type ChatVarType = (typeof ChatVarType)[keyof typeof ChatVarType]
