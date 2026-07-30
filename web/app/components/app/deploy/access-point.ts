export type AccessPoint = 'mcp' | 'serviceApi' | 'trigger' | 'webApp'

export const ACCESS_POINT_ORDER: readonly AccessPoint[] = ['webApp', 'serviceApi', 'mcp', 'trigger']
