import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'

export type AccessControlPolicy = Pick<NetworkAccessGroupResponse, 'id' | 'name' | 'allowed_cidrs'>

export type AccessControlDraft = {
  selectedPolicyId: string | null
  scopes: Record<AccessPoint, boolean>
  enabled: boolean
}

export const createDefaultAccessControlDraft = (
  availableAccessPoints: readonly AccessPoint[],
): AccessControlDraft => ({
  selectedPolicyId: null,
  enabled: true,
  scopes: {
    webApp: availableAccessPoints.includes('webApp'),
    serviceApi: availableAccessPoints.includes('serviceApi'),
    mcp: availableAccessPoints.includes('mcp'),
    trigger: availableAccessPoints.includes('trigger'),
  },
})

export function isAccessControlDraftEqual(
  left: AccessControlDraft,
  right: AccessControlDraft,
  availableAccessPoints: readonly AccessPoint[],
) {
  if (left.selectedPolicyId !== right.selectedPolicyId) return false
  if (left.enabled !== right.enabled) return false

  return availableAccessPoints.every((scope) => left.scopes[scope] === right.scopes[scope])
}

export function hasSelectedAccessPoint(
  draft: AccessControlDraft,
  availableAccessPoints: readonly AccessPoint[],
) {
  return availableAccessPoints.some((scope) => draft.scopes[scope])
}

export function canSaveAccessControl({
  draft,
  baseline,
  availableAccessPoints,
}: {
  draft: AccessControlDraft
  baseline?: AccessControlDraft
  availableAccessPoints: readonly AccessPoint[]
}) {
  if (!availableAccessPoints.length) return false
  if (baseline && isAccessControlDraftEqual(draft, baseline, availableAccessPoints)) return false
  if (!draft.enabled) return Boolean(draft.selectedPolicyId)
  if (!draft.selectedPolicyId) return false
  return hasSelectedAccessPoint(draft, availableAccessPoints)
}
