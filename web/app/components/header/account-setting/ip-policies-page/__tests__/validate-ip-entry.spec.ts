import {
  canSubmitIpPolicy,
  collectAllowedCidrs,
  collectIpAddresses,
  IP_POLICY_CIDR_MAX_COUNT,
  IP_POLICY_NAME_MAX_LENGTH,
  toAllowedCidr,
  validateIpEntry,
} from '../validate-ip-entry'

describe('validateIpEntry', () => {
  it('treats blank input as empty, not invalid', () => {
    expect(validateIpEntry('')).toEqual({ kind: 'empty' })
    expect(validateIpEntry('   ')).toEqual({ kind: 'empty' })
  })

  it('accepts IPv4 addresses, IPv6 addresses, and CIDR ranges', () => {
    expect(validateIpEntry('10.0.0.0/8')).toEqual({ kind: 'valid' })
    expect(validateIpEntry('203.0.113.42')).toEqual({ kind: 'valid' })
    expect(validateIpEntry('0.0.0.0/0')).toEqual({ kind: 'valid' })
    expect(validateIpEntry('2001:db8:1f4a:2c::5')).toEqual({ kind: 'valid' })
    expect(validateIpEntry('3fff:100::/32')).toEqual({ kind: 'valid' })
    expect(validateIpEntry('::1')).toEqual({ kind: 'valid' })
    expect(validateIpEntry('2001:db8::1')).toEqual({ kind: 'valid' })
  })

  it('rejects more than one slash', () => {
    expect(validateIpEntry('10.0.0.0/8/16')).toEqual({
      kind: 'invalid',
      code: 'multipleSlashes',
    })
  })

  it('rejects IPv4 leading zeros', () => {
    expect(validateIpEntry('192.168.01.1')).toEqual({ kind: 'invalid', code: 'leadingZeros' })
  })

  it('rejects IPv4 octets outside 0–255', () => {
    expect(validateIpEntry('256.100.50.25')).toEqual({ kind: 'invalid', code: 'octetRange' })
    expect(validateIpEntry('203.0.113.999')).toEqual({ kind: 'invalid', code: 'octetRange' })
  })

  it('rejects a non-numeric prefix length', () => {
    expect(validateIpEntry('10.0.0.0/ab')).toEqual({ kind: 'invalid', code: 'prefixNotNumber' })
    expect(validateIpEntry('2001:db8::/x')).toEqual({ kind: 'invalid', code: 'prefixNotNumber' })
  })

  it('rejects prefix lengths outside the address family range', () => {
    expect(validateIpEntry('192.168.1.0/33')).toEqual({
      kind: 'invalid',
      code: 'prefixRange',
      max: 32,
    })
    expect(validateIpEntry('3fff:100::/129')).toEqual({
      kind: 'invalid',
      code: 'prefixRange',
      max: 128,
    })
  })

  it('rejects invalid IPv6 addresses', () => {
    expect(validateIpEntry('gggg::1')).toEqual({ kind: 'invalid', code: 'invalidIpv6' })
    expect(validateIpEntry('2001:db8:::1')).toEqual({ kind: 'invalid', code: 'invalidIpv6' })
  })

  it('rejects ranges, wildcards, and hostnames', () => {
    expect(validateIpEntry('192.168.1.1 - 192.168.1.50')).toEqual({
      kind: 'invalid',
      code: 'unsupported',
    })
    expect(validateIpEntry('10.0.0.*')).toEqual({ kind: 'invalid', code: 'unsupported' })
    expect(validateIpEntry('office.example.com')).toEqual({ kind: 'invalid', code: 'unsupported' })
  })
})

describe('canSubmitIpPolicy', () => {
  it('requires a name and at least one valid entry', () => {
    expect(canSubmitIpPolicy('', ['10.0.0.0/8'])).toBe(false)
    expect(canSubmitIpPolicy('Office', [''])).toBe(false)
    expect(canSubmitIpPolicy('Office', ['10.0.0.0/8'])).toBe(true)
    expect(canSubmitIpPolicy('Office', ['10.0.0.0/8', ''])).toBe(true)
  })

  it('blocks submit when any non-empty entry is invalid', () => {
    expect(canSubmitIpPolicy('Office', ['10.0.0.0/8', '203.0.113.999'])).toBe(false)
  })
})

describe('collectIpAddresses', () => {
  it('drops blank rows', () => {
    expect(collectIpAddresses([' 10.0.0.0/8 ', '', '203.0.113.42'])).toEqual([
      '10.0.0.0/8',
      '203.0.113.42',
    ])
  })
})

describe('toAllowedCidr', () => {
  it('appends /32 to bare IPv4 addresses and /128 to bare IPv6 addresses', () => {
    expect(toAllowedCidr('203.0.113.42')).toBe('203.0.113.42/32')
    expect(toAllowedCidr('::1')).toBe('::1/128')
    expect(toAllowedCidr('10.0.0.0/8')).toBe('10.0.0.0/8')
  })
})

describe('collectAllowedCidrs', () => {
  it('normalizes submitted entries to CIDR notation', () => {
    expect(collectAllowedCidrs([' 203.0.113.42 ', '', '10.0.0.0/8'])).toEqual([
      '203.0.113.42/32',
      '10.0.0.0/8',
    ])
  })
})

describe('canSubmitIpPolicy limits', () => {
  it('rejects names longer than the API maximum', () => {
    expect(canSubmitIpPolicy('n'.repeat(IP_POLICY_NAME_MAX_LENGTH + 1), ['10.0.0.0/8'])).toBe(false)
    expect(canSubmitIpPolicy('n'.repeat(IP_POLICY_NAME_MAX_LENGTH), ['10.0.0.0/8'])).toBe(true)
  })

  it('rejects more CIDRs than the API maximum', () => {
    const cidrs = Array.from(
      { length: IP_POLICY_CIDR_MAX_COUNT + 1 },
      (_, index) => `10.0.0.${index}`,
    )
    expect(canSubmitIpPolicy('Office', cidrs)).toBe(false)
  })
})
