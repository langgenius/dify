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
  if (address.includes('.')) return false

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

export function canSubmitIpPolicy(name: string, entries: readonly string[]) {
  if (name.trim() === '') return false

  const trimmed = entries.map((entry) => entry.trim())
  if (trimmed.every((entry) => entry === '')) return false

  return trimmed.every((entry) => {
    const result = validateIpEntry(entry)
    return result.kind === 'empty' || result.kind === 'valid'
  })
}

export function collectIpAddresses(entries: readonly string[]) {
  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
}
