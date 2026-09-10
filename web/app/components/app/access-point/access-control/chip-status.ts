import type { AccessControlDraft, AccessControlScopeAvailability } from './draft'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'

export type AccessControlAssignment = {
  policyId: string
  policyName: string
  scopes: AccessControlDraft['scopes']
  enabled: boolean
}

export type AccessControlChipKind = 'pro' | 'off' | 'paused' | 'on' | 'partial'

export type AccessControlChipState = {
  kind: AccessControlChipKind
  coveredCount: number
  inServiceCount: number
  policyName?: string
}

export function getInServiceCoverage(
  scopes: Record<AccessPoint, boolean>,
  availability: AccessControlScopeAvailability,
) {
  const inService = ACCESS_POINT_ORDER.filter((scope) => availability[scope])
  const covered = inService.filter((scope) => scopes[scope])

  return {
    coveredCount: covered.length,
    inServiceCount: inService.length,
  }
}

export function getAccessControlChipState({
  entitled,
  assignment,
  availability,
}: {
  entitled?: boolean
  assignment: AccessControlAssignment | null
  availability: AccessControlScopeAvailability
}): AccessControlChipState {
  if (!assignment) {
    if (entitled === false) return { kind: 'pro', coveredCount: 0, inServiceCount: 0 }
    return { kind: 'off', coveredCount: 0, inServiceCount: 0 }
  }

  const coverage = getInServiceCoverage(assignment.scopes, availability)

  if (!assignment.enabled) {
    return {
      kind: 'paused',
      policyName: assignment.policyName,
      ...coverage,
    }
  }

  return {
    kind:
      coverage.inServiceCount > 0 && coverage.coveredCount === coverage.inServiceCount
        ? 'on'
        : 'partial',
    policyName: assignment.policyName,
    ...coverage,
  }
}
