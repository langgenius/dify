import { describe, expect, it } from 'vitest'
import { isEmpty, uniqueId } from './toolkit-helpers'

describe('uniqueId', () => {
  it('should generate unique IDs', () => {
    const id1 = uniqueId()
    const id2 = uniqueId()
    expect(id1).not.toBe(id2)
  })

  it('should use prefix when provided', () => {
    const id = uniqueId('test-')
    expect(id.startsWith('test-')).toBe(true)
  })

  it('should work with empty prefix', () => {
    const id = uniqueId('')
    expect(id).toMatch(/^\d+$/)
  })
})

describe('isEmpty', () => {
  it('should return true for null', () => {
    expect(isEmpty(null)).toBe(true)
  })

  it('should return true for undefined', () => {
    expect(isEmpty(undefined)).toBe(true)
  })

  it('should return true for empty string', () => {
    expect(isEmpty('')).toBe(true)
  })

  it('should return false for non-empty string', () => {
    expect(isEmpty('hello')).toBe(false)
  })

  it('should return true for empty array', () => {
    expect(isEmpty([])).toBe(true)
  })

  it('should return false for non-empty array', () => {
    expect(isEmpty([1, 2, 3])).toBe(false)
  })

  it('should return true for empty object', () => {
    expect(isEmpty({})).toBe(true)
  })

  it('should return false for non-empty object', () => {
    expect(isEmpty({ key: 'value' })).toBe(false)
  })

  it('should return true for empty Map', () => {
    expect(isEmpty(new Map())).toBe(true)
  })

  it('should return false for non-empty Map', () => {
    const map = new Map()
    map.set('key', 'value')
    expect(isEmpty(map)).toBe(false)
  })

  it('should return true for empty Set', () => {
    expect(isEmpty(new Set())).toBe(true)
  })

  it('should return false for non-empty Set', () => {
    expect(isEmpty(new Set([1, 2]))).toBe(false)
  })
})
