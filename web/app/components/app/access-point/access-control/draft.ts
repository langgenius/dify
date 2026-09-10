import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { AppModeEnum } from '@/types/app'

export type AccessControlScopeAvailability = Record<AccessPoint, boolean>

export type AccessControlPolicy = Pick<NetworkAccessGroupResponse, 'id' | 'name' | 'allowed_cidrs'>

export type AccessControlDraft = {
  selectedPolicyId: string | null
  scopes: Record<AccessPoint, boolean>
  enabled: boolean
}

export const createDefaultAccessControlDraft = (
  availability?: AccessControlScopeAvailability,
): AccessControlDraft => ({
  selectedPolicyId: null,
  enabled: true,
  scopes: {
    webApp: availability?.webApp ?? true,
    serviceApi: availability?.serviceApi ?? true,
    mcp: availability?.mcp ?? true,
    trigger: availability?.trigger ?? false,
  },
})

export function getAccessControlScopeSupport(
  mode: AppModeEnum | undefined,
): AccessControlScopeAvailability {
  if (mode === AppModeEnum.AGENT) {
    return { webApp: true, serviceApi: true, mcp: false, trigger: false }
  }

  if (mode === AppModeEnum.WORKFLOW) {
    return { webApp: true, serviceApi: true, mcp: true, trigger: true }
  }

  return { webApp: true, serviceApi: true, mcp: true, trigger: false }
}

export function getAccessControlScopeAvailability({
  mode,
  hasTriggerNode,
  isUnpublished,
}: {
  mode: AppModeEnum | undefined
  hasTriggerNode: boolean
  isUnpublished: boolean
}): AccessControlScopeAvailability {
  const support = getAccessControlScopeSupport(mode)

  return {
    ...support,
    trigger: support.trigger && !isUnpublished && hasTriggerNode,
  }
}

export function isProtectableAccessPoint(
  scope: AccessPoint,
  availability: AccessControlScopeAvailability,
) {
  return availability[scope]
}

export function isAccessControlDraftEqual(left: AccessControlDraft, right: AccessControlDraft) {
  if (left.selectedPolicyId !== right.selectedPolicyId) return false
  if (left.enabled !== right.enabled) return false

  return ACCESS_POINT_ORDER.every((scope) => left.scopes[scope] === right.scopes[scope])
}

export function hasSelectedProtectableAccessPoint(
  draft: AccessControlDraft,
  availability: AccessControlScopeAvailability,
) {
  return ACCESS_POINT_ORDER.some((scope) => {
    if (!isProtectableAccessPoint(scope, availability)) return false
    return draft.scopes[scope]
  })
}

export function canSaveAccessControl({
  draft,
  availability,
  baseline,
}: {
  draft: AccessControlDraft
  availability: AccessControlScopeAvailability
  baseline?: AccessControlDraft
}) {
  if (baseline && isAccessControlDraftEqual(draft, baseline)) return false
  if (!draft.enabled) return Boolean(draft.selectedPolicyId)
  if (!draft.selectedPolicyId) return false
  return hasSelectedProtectableAccessPoint(draft, availability)
}
