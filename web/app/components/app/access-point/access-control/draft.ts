import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'

export type AccessControlPolicy = Pick<NetworkAccessGroupResponse, 'id' | 'name' | 'allowed_cidrs'>

export type AccessControlDraft = {
  selectedPolicyId: string | null
  scopes: Record<AccessPoint, boolean>
  enabled: boolean
}

export const createDefaultAccessControlDraft = (): AccessControlDraft => ({
  selectedPolicyId: null,
  enabled: true,
  scopes: {
    webApp: true,
    serviceApi: true,
    mcp: true,
    trigger: true,
  },
})

export function isAccessControlDraftEqual(left: AccessControlDraft, right: AccessControlDraft) {
  if (left.selectedPolicyId !== right.selectedPolicyId) return false
  if (left.enabled !== right.enabled) return false

  return ACCESS_POINT_ORDER.every((scope) => left.scopes[scope] === right.scopes[scope])
}

export function hasSelectedAccessPoint(draft: AccessControlDraft) {
  return ACCESS_POINT_ORDER.some((scope) => draft.scopes[scope])
}

export function canSaveAccessControl({
  draft,
  baseline,
  persistableAccessPoints,
}: {
  draft: AccessControlDraft
  baseline?: AccessControlDraft
  persistableAccessPoints?: readonly string[]
}) {
  if (baseline && isAccessControlDraftEqual(draft, baseline)) return false
  if (!draft.enabled) return Boolean(draft.selectedPolicyId)
  if (!draft.selectedPolicyId) return false
  if (persistableAccessPoints) return persistableAccessPoints.length > 0
  return hasSelectedAccessPoint(draft)
}
