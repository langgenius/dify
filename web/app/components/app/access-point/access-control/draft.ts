import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { AppModeEnum } from '@/types/app'

export type AccessControlScopeAvailability = Record<AccessPoint, boolean>

export type AccessControlPolicy = {
  id: string
  name: string
  addresses: readonly string[]
}

export type AccessControlDraft = {
  selectedPolicyId: string | null
  scopes: Record<AccessPoint, boolean>
}

export const createDefaultAccessControlDraft = (): AccessControlDraft => ({
  selectedPolicyId: null,
  scopes: {
    webApp: true,
    serviceApi: true,
    mcp: false,
    trigger: false,
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

export function canSaveAccessControl({
  draft,
  availability,
}: {
  draft: AccessControlDraft
  availability: AccessControlScopeAvailability
}) {
  if (!draft.selectedPolicyId) return false

  return ACCESS_POINT_ORDER.some((scope) => {
    if (!isProtectableAccessPoint(scope, availability)) return false
    return draft.scopes[scope]
  })
}

export function splitPolicySummary(addresses: readonly string[]): {
  listed: readonly string[]
  moreCount: number
} {
  if (addresses.length <= 2) return { listed: addresses, moreCount: 0 }
  return { listed: addresses.slice(0, 2), moreCount: addresses.length - 2 }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8) + octet
  }

  return value >>> 0
}

function ipv4InCidr(ip: string, network: string, prefix: number): boolean {
  const ipInt = ipv4ToInt(ip)
  const networkInt = ipv4ToInt(network)
  if (ipInt === null || networkInt === null) return false
  if (prefix === 0) return true
  const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0
  return (ipInt & mask) === (networkInt & mask)
}

export function policyIncludesIp(addresses: readonly string[], ip: string): boolean {
  return addresses.some((entry) => {
    if (entry === ip) return true
    const slash = entry.indexOf('/')
    if (slash === -1) return false
    const network = entry.slice(0, slash)
    const prefix = Number(entry.slice(slash + 1))
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
    return ipv4InCidr(ip, network, prefix)
  })
}
