export type AccessPoint = 'mcp' | 'serviceApi' | 'trigger' | 'webApp'

export const ACCESS_POINT_ORDER = [
  'webApp',
  'serviceApi',
  'mcp',
  'trigger',
] as const satisfies readonly AccessPoint[]

export function getAccessPointHref(appId: string, environmentId: string, accessPoint: AccessPoint) {
  const searchParams = new URLSearchParams({
    environment: environmentId,
    accessPoint,
  })

  return `/app/${appId}/access-point?${searchParams.toString()}`
}
