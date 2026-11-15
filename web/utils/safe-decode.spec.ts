import { describe, expect, it } from 'vitest'
import { safeDecodeURIComponent } from './safe-decode'

describe('safeDecodeURIComponent', () => {
  it('decodes a valid percent-encoded value', () => {
    expect(safeDecodeURIComponent('user%40example.com')).toBe('user@example.com')
  })

  it('returns an empty string for a missing parameter', () => {
    expect(safeDecodeURIComponent(null)).toBe('')
    expect(safeDecodeURIComponent(undefined)).toBe('')
    expect(safeDecodeURIComponent('')).toBe('')
  })

  it('returns the raw value when percent-encoding is malformed', () => {
    expect(safeDecodeURIComponent('%')).toBe('%')
    expect(safeDecodeURIComponent('token%')).toBe('token%')
    expect(safeDecodeURIComponent('%E0%A4%A')).toBe('%E0%A4%A')
  })

  it('passes plain values through unchanged', () => {
    expect(safeDecodeURIComponent('plain-token')).toBe('plain-token')
  })
})
