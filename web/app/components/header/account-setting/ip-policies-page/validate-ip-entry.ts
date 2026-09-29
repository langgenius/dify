export type IpEntryErrorCode =
  | 'multipleSlashes'
  | 'leadingZeros'
  | 'octetRange'
  | 'prefixNotNumber'
  | 'prefixRange'
  | 'invalidIpv6'
  | 'unsupported'

export type IpEntryValidation =
  | { kind: 'empty' }
  | { kind: 'valid' }
  | { kind: 'invalid'; code: IpEntryErrorCode; max?: 32 | 128 }

function isHexGroup(group: string) {
  return /^[0-9a-f]{1,4}$/i.test(group)
}

function parsePrefix(prefix: string): { kind: 'ok'; value: number } | { kind: 'notNumber' } {
  if (!/^\d+$/.test(prefix)) return { kind: 'notNumber' }
  return { kind: 'ok', value: Number(prefix) }
}

function parseIpv4(address: string): 'valid' | 'leadingZeros' | 'octetRange' | 'unsupported' {
  const parts = address.split('.')
  if (parts.length !== 4) return 'unsupported'

  for (const part of parts) {
    if (part === '') return 'unsupported'
    if (!/^\d+$/.test(part)) return 'unsupported'
    if (part.length > 1 && part.startsWith('0')) return 'leadingZeros'
    const octet = Number(part)
    if (octet > 255) return 'octetRange'
  }

  return 'valid'
}

function parseIpv6(address: string): boolean {
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    const embeddedIpv4 = address.slice(lastColon + 1)
    if (parseIpv4(embeddedIpv4) !== 'valid') return false
    const octets = embeddedIpv4.split('.').map(Number)
    const high = ((octets[0] ?? 0) * 256 + (octets[1] ?? 0)).toString(16)
    const low = ((octets[2] ?? 0) * 256 + (octets[3] ?? 0)).toString(16)
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`
  }

  const sides = address.split('::')
  if (sides.length > 2) return false

  if (sides.length === 2) {
    const leftSide = sides[0] ?? ''
    const rightSide = sides[1] ?? ''
    const left = leftSide === '' ? [] : leftSide.split(':')
    const right = rightSide === '' ? [] : rightSide.split(':')
    if (left.some((group) => !isHexGroup(group)) || right.some((group) => !isHexGroup(group)))
      return false
    return left.length + right.length < 8
  }

  const groups = address.split(':')
  return groups.length === 8 && groups.every(isHexGroup)
}

export function validateIpEntry(raw: string): IpEntryValidation {
  const value = raw.trim()
  if (value === '') return { kind: 'empty' }

  const slashCount = (value.match(/\//g) ?? []).length
  if (slashCount > 1) return { kind: 'invalid', code: 'multipleSlashes' }

  const slashIndex = value.indexOf('/')
  const address = slashIndex === -1 ? value : value.slice(0, slashIndex)
  const prefix = slashIndex === -1 ? undefined : value.slice(slashIndex + 1)

  if (address.includes(':')) {
    if (prefix !== undefined) {
      const parsed = parsePrefix(prefix)
      if (parsed.kind === 'notNumber') return { kind: 'invalid', code: 'prefixNotNumber' }
      if (parsed.value < 0 || parsed.value > 128)
        return { kind: 'invalid', code: 'prefixRange', max: 128 }
    }
    if (!parseIpv6(address)) return { kind: 'invalid', code: 'invalidIpv6' }
    return { kind: 'valid' }
  }

  if (address.includes('.')) {
    const ipv4 = parseIpv4(address)
    if (ipv4 === 'leadingZeros') return { kind: 'invalid', code: 'leadingZeros' }
    if (ipv4 === 'octetRange') return { kind: 'invalid', code: 'octetRange' }
    if (ipv4 === 'unsupported') return { kind: 'invalid', code: 'unsupported' }
    if (prefix !== undefined) {
      const parsed = parsePrefix(prefix)
      if (parsed.kind === 'notNumber') return { kind: 'invalid', code: 'prefixNotNumber' }
      if (parsed.value < 0 || parsed.value > 32)
        return { kind: 'invalid', code: 'prefixRange', max: 32 }
    }
    return { kind: 'valid' }
  }

  if (prefix !== undefined) {
    const parsed = parsePrefix(prefix)
    if (parsed.kind === 'notNumber') return { kind: 'invalid', code: 'prefixNotNumber' }
  }

  return { kind: 'invalid', code: 'unsupported' }
}

export const IP_POLICY_NAME_MAX_LENGTH = 100
export const IP_POLICY_CIDR_MAX_COUNT = 100

export function canSubmitIpPolicy(name: string, entries: readonly string[]) {
  const trimmedName = name.trim()
  if (trimmedName === '' || trimmedName.length > IP_POLICY_NAME_MAX_LENGTH) return false

  const cidrs = collectAllowedCidrs(entries)
  if (cidrs.length === 0 || cidrs.length > IP_POLICY_CIDR_MAX_COUNT) return false

  return entries.every((entry) => {
    const result = validateIpEntry(entry)
    return result.kind === 'empty' || result.kind === 'valid'
  })
}

export function collectIpAddresses(entries: readonly string[]) {
  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
}

export function toAllowedCidr(entry: string): string {
  const value = entry.trim()
  if (value.includes('/')) return value
  if (value.includes(':')) return `${value}/128`
  return `${value}/32`
}

export function collectAllowedCidrs(entries: readonly string[]) {
  return collectIpAddresses(entries).map(toAllowedCidr)
}

/** Compare host entries, including compressed and IPv4-mapped IPv6, without matching ranges. */
export function isSameIpAddress(entry: string, ip: string): boolean {
  const normalize = (raw: string) => {
    const value = raw.trim()
    if (validateIpEntry(value).kind !== 'valid') return null
    const [address = '', prefix] = value.split('/')
    const ipv6 = address.includes(':')
    if (prefix !== undefined && Number(prefix) !== (ipv6 ? 128 : 32)) return null
    if (!ipv6) return address
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical)
    if (!mapped) return canonical
    const high = Number.parseInt(mapped[1] ?? '', 16)
    const low = Number.parseInt(mapped[2] ?? '', 16)
    return [high >> 8, high & 255, low >> 8, low & 255].join('.')
  }
  const address = normalize(entry)
  return address !== null && address === normalize(ip)
}

export function splitPolicySummary(addresses: readonly string[]): {
  listed: readonly string[]
  moreCount: number
} {
  if (addresses.length <= 2) return { listed: addresses, moreCount: 0 }
  return { listed: addresses.slice(0, 2), moreCount: addresses.length - 2 }
}
