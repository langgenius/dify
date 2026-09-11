import type {
  AppNetworkAccessGroupBindingResponse,
  AppNetworkAccessGroupResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { AccessControlDraft } from './draft'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { createDefaultAccessControlDraft } from './draft'

export type NetworkAccessPoint = AppNetworkAccessGroupResponse['available_access_points'][number]

const ACCESS_POINT_TO_API = {
  webApp: 'webapp',
  serviceApi: 'service_api',
  mcp: 'mcp',
  trigger: 'trigger',
} as const satisfies Record<AccessPoint, NetworkAccessPoint>

const API_TO_ACCESS_POINT = {
  webapp: 'webApp',
  service_api: 'serviceApi',
  mcp: 'mcp',
  trigger: 'trigger',
} as const satisfies Record<NetworkAccessPoint, AccessPoint>

export function toApiAccessPoint(accessPoint: AccessPoint): NetworkAccessPoint {
  return ACCESS_POINT_TO_API[accessPoint]
}

export function toUiAccessPoint(accessPoint: NetworkAccessPoint): AccessPoint {
  return API_TO_ACCESS_POINT[accessPoint]
}

export function getNetworkAccessErrorStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof error.status === 'number') return error.status
    if (
      'response' in error &&
      typeof error.response === 'object' &&
      error.response !== null &&
      'status' in error.response &&
      typeof error.response.status === 'number'
    )
      return error.response.status
  }
}

export function scopesFromAccessPoints(
  accessPoints: readonly string[],
): AccessControlDraft['scopes'] {
  const selected = new Set(
    accessPoints.flatMap((accessPoint) => {
      if (accessPoint in API_TO_ACCESS_POINT)
        return [toUiAccessPoint(accessPoint as NetworkAccessPoint)]
      return []
    }),
  )

  return {
    webApp: selected.has('webApp'),
    serviceApi: selected.has('serviceApi'),
    mcp: selected.has('mcp'),
    trigger: selected.has('trigger'),
  }
}

export function accessPointsFromScopes(
  scopes: AccessControlDraft['scopes'],
  availableAccessPoints?: readonly string[],
): NetworkAccessPoint[] {
  const allowed = availableAccessPoints ? new Set(availableAccessPoints) : null

  return ACCESS_POINT_ORDER.filter((accessPoint) => {
    if (!scopes[accessPoint]) return false
    if (!allowed) return true
    return allowed.has(toApiAccessPoint(accessPoint))
  }).map(toApiAccessPoint)
}

export function draftFromBinding(
  binding: AppNetworkAccessGroupBindingResponse | null | undefined,
): AccessControlDraft {
  if (!binding?.group_id) return createDefaultAccessControlDraft()

  return {
    selectedPolicyId: binding.group_id,
    enabled: binding.enabled,
    scopes: scopesFromAccessPoints(binding.access_points),
  }
}
