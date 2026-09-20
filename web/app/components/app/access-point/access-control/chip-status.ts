import type { AccessControlDraft } from './draft'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'

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
  availableAccessPoints: readonly AccessPoint[],
) {
  const covered = availableAccessPoints.filter((scope) => scopes[scope])

  return {
    coveredCount: covered.length,
    inServiceCount: availableAccessPoints.length,
  }
}

export function getAccessControlChipState({
  entitled,
  assignment,
  availableAccessPoints,
}: {
  entitled?: boolean
  assignment: AccessControlAssignment | null
  availableAccessPoints: readonly AccessPoint[]
}): AccessControlChipState {
  if (entitled === false) return { kind: 'pro', coveredCount: 0, inServiceCount: 0 }
  if (!assignment) {
    return { kind: 'off', coveredCount: 0, inServiceCount: 0 }
  }

  const coverage = getInServiceCoverage(assignment.scopes, availableAccessPoints)

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
