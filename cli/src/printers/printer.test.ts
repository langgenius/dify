import { describe, expect, it } from 'vitest'
import {
  isModer,
  isNoCompatiblePrinter,
  isRawObject,
  NoCompatiblePrinterError,
  payload,
} from './printer.js'

describe('NoCompatiblePrinterError', () => {
  it('mentions format and allowed list when allowed is non-empty', () => {
    const err = new NoCompatiblePrinterError('xml', ['json', 'yaml'])
    expect(err.message).toContain('xml')
    expect(err.message).toContain('json')
    expect(err.message).toContain('yaml')
  })

  it('mentions only format when allowed list is empty', () => {
    const err = new NoCompatiblePrinterError('xml', [])
    expect(err.message).toContain('xml')
    expect(err.message).toContain('not supported')
    expect(err.message).not.toContain('allowed')
  })

  it('exposes format and allowed publicly for callers that branch on them', () => {
    const err = new NoCompatiblePrinterError('xml', ['json'])
    expect(err.format).toBe('xml')
    expect(err.allowed).toEqual(['json'])
  })

  it('has a stable name for serialization', () => {
    const err = new NoCompatiblePrinterError('xml', [])
    expect(err.name).toBe('NoCompatiblePrinterError')
  })
})

describe('isNoCompatiblePrinter', () => {
  it('matches NoCompatiblePrinterError instances', () => {
    expect(isNoCompatiblePrinter(new NoCompatiblePrinterError('xml', ['json']))).toBe(true)
  })

  it('does not match plain Error', () => {
    expect(isNoCompatiblePrinter(new Error('other'))).toBe(false)
  })

  it('does not match a wrapped error message', () => {
    expect(isNoCompatiblePrinter(new Error('wrapped: output format "xml" not supported'))).toBe(false)
  })

  it('does not match null/undefined/primitives', () => {
    expect(isNoCompatiblePrinter(null)).toBe(false)
    expect(isNoCompatiblePrinter(undefined)).toBe(false)
    expect(isNoCompatiblePrinter('string')).toBe(false)
    expect(isNoCompatiblePrinter(42)).toBe(false)
  })
})

describe('isRawObject', () => {
  it('detects objects exposing raw()', () => {
    expect(isRawObject({ raw: () => 42 })).toBe(true)
  })

  it('rejects values without raw()', () => {
    expect(isRawObject({})).toBe(false)
    expect(isRawObject(null)).toBe(false)
    expect(isRawObject(undefined)).toBe(false)
    expect(isRawObject(42)).toBe(false)
  })

  it('rejects objects where raw is not callable', () => {
    expect(isRawObject({ raw: 42 })).toBe(false)
  })
})

describe('isModer', () => {
  it('detects objects exposing mode()', () => {
    expect(isModer({ mode: () => 'chat' })).toBe(true)
  })

  it('rejects values without mode()', () => {
    expect(isModer({})).toBe(false)
    expect(isModer(null)).toBe(false)
    expect(isModer({ mode: 'chat' })).toBe(false)
  })
})

describe('payload', () => {
  it('unwraps RawObject via raw()', () => {
    expect(payload({ raw: () => ({ id: 'a' }) })).toEqual({ id: 'a' })
  })

  it('returns the value as-is when it is not a RawObject', () => {
    const obj = { id: 'a' }
    expect(payload(obj)).toBe(obj)
  })

  it('returns primitives untouched', () => {
    expect(payload(42)).toBe(42)
    expect(payload(null)).toBeNull()
  })
})
