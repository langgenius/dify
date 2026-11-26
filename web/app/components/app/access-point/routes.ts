import type { AccessPoint } from '@/models/app-access-point'

export function getAccessPointHref(appId: string, environmentId: string, accessPoint: AccessPoint) {
  const searchParams = new URLSearchParams({
    environment: environmentId,
    accessPoint,
  })

  return `/app/${appId}/access-point?${searchParams.toString()}`
}
