export type AccessPoint = 'mcp' | 'serviceApi' | 'trigger' | 'webApp'

export const ACCESS_POINT_ORDER = [
  'webApp',
  'serviceApi',
  'mcp',
  'trigger',
] as const satisfies readonly AccessPoint[]
