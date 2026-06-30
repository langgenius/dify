import { describe, expect, it } from 'vitest'
import { compatString, difyCompat, evaluateCompat } from './compat'

describe('difyCompat', () => {
  it('exposes minDify and maxDify as readonly strings', () => {
    expect(typeof difyCompat.minDify).toBe('string')
    expect(typeof difyCompat.maxDify).toBe('string')
  })
})

describe('compatString', () => {
  it('formats as "dify >=min, <=max"', () => {
    expect(compatString()).toMatch(/^dify >=\d+\.\d+\.\d+(-[\w.]+)?, <=\d+\.\d+\.\d+(-[\w.]+)?$/)
  })
})

describe('evaluateCompat', () => {
  const range = { minDify: '1.6.0', maxDify: '1.7.0' }

  it('returns compatible when server version is in range', () => {
    expect(evaluateCompat('1.6.4', range)).toEqual({
      status: 'compatible',
      detail: 'server 1.6.4 in [1.6.0, 1.7.0]',
    })
  })

  it('returns compatible at the lower bound', () => {
    expect(evaluateCompat('1.6.0', range).status).toBe('compatible')
  })

  it('returns compatible at the upper bound (inclusive)', () => {
    expect(evaluateCompat('1.7.0', range).status).toBe('compatible')
  })

  it('returns unsupported when server is below minimum', () => {
    const v = evaluateCompat('1.5.9', range)
    expect(v.status).toBe('unsupported')
    expect(v.detail).toContain('1.5.9')
  })

  it('returns unsupported when server is above maximum', () => {
    expect(evaluateCompat('2.0.0', range).status).toBe('unsupported')
  })

  it('returns unknown when server version is empty', () => {
    expect(evaluateCompat('', range).status).toBe('unknown')
    expect(evaluateCompat(undefined, range).status).toBe('unknown')
  })

  it('returns unknown when server version is not valid semver', () => {
    const v = evaluateCompat('totally-not-semver', range)
    expect(v.status).toBe('unknown')
    expect(v.detail).toContain('not valid semver')
  })

  it('clamps malformed server versions to 80 chars in the detail string', () => {
    const malicious = 'x'.repeat(10_000)
    const v = evaluateCompat(malicious, range)
    expect(v.status).toBe('unknown')
    // detail = `server version "<=80 chars + ellipsis>" is not valid semver`;
    // a bit of leeway for the surrounding text, but nowhere near 10k.
    expect(v.detail.length).toBeLessThan(150)
    expect(v.detail).toContain('…')
  })

  it('returns unknown when compat range itself is not valid semver', () => {
    const v = evaluateCompat('1.6.4', { minDify: 'foo', maxDify: 'bar' })
    expect(v.status).toBe('unknown')
  })

  it('uses the bundled difyCompat range by default', () => {
    // Build-info range comes from package.json#difyctl.compat (or env at build
    // time); a server version equal to the lower bound must be compatible.
    expect(evaluateCompat(difyCompat.minDify).status).toBe('compatible')
  })
})
