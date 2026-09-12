import { describe, expect, it } from 'vitest'
import { isPrivateOrLocalAddress } from '../urlValidation'

describe('isPrivateOrLocalAddress', () => {
  it('keeps treating public hosts as public', () => {
    expect(isPrivateOrLocalAddress('https://dify.ai')).toBe(false)
    expect(isPrivateOrLocalAddress('http://example.com')).toBe(false)
    expect(isPrivateOrLocalAddress('http://8.8.8.8')).toBe(false)
    expect(isPrivateOrLocalAddress('http://[2001:db8::1]')).toBe(false)
  })

  it('treats localhost, the whole 127.0.0.0/8 range and 0.0.0.0 as private', () => {
    expect(isPrivateOrLocalAddress('http://localhost:8080/x')).toBe(true)
    expect(isPrivateOrLocalAddress('http://127.0.0.1')).toBe(true)
    expect(isPrivateOrLocalAddress('http://127.0.0.2')).toBe(true)
    expect(isPrivateOrLocalAddress('http://0.0.0.0')).toBe(true)
  })

  it('recognizes bracketed IPv6 literals', () => {
    expect(isPrivateOrLocalAddress('http://[::1]:8080/x')).toBe(true)
    expect(isPrivateOrLocalAddress('http://[fd00::1]')).toBe(true)
    expect(isPrivateOrLocalAddress('http://[fc00::1]')).toBe(true)
  })

  it('keeps the existing IPv4 range and .local behavior', () => {
    expect(isPrivateOrLocalAddress('http://10.0.0.1')).toBe(true)
    expect(isPrivateOrLocalAddress('http://172.16.0.1')).toBe(true)
    expect(isPrivateOrLocalAddress('http://192.168.1.1')).toBe(true)
    expect(isPrivateOrLocalAddress('http://169.254.1.1')).toBe(true)
    expect(isPrivateOrLocalAddress('http://nas.local')).toBe(true)
  })
})
