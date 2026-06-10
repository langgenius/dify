import { describe, expect, it } from 'vitest'
import escape from '../escape'

describe('escape', () => {
  // Basic special character escaping
  it('should escape null character', () => {
    expect(escape('\0')).toBe('\\0')
  })

  it('should escape backspace', () => {
    expect(escape('\b')).toBe('\\b')
  })

  it('should escape form feed', () => {
    expect(escape('\f')).toBe('\\f')
  })

  it('should escape newline', () => {
    expect(escape('\n')).toBe('\\n')
  })

  it('should escape carriage return', () => {
    expect(escape('\r')).toBe('\\r')
  })

  it('should escape tab', () => {
    expect(escape('\t')).toBe('\\t')
  })

  it('should escape vertical tab', () => {
    expect(escape('\v')).toBe('\\v')
  })

  it('should escape single quote', () => {
    expect(escape('\'')).toBe('\\\'')
  })

  // Multiple special characters in one string
  it('should escape multiple special characters', () => {
    expect(escape('line1\nline2\ttab')).toBe('line1\\nline2\\ttab')
  })

  it('should escape mixed special characters', () => {
    expect(escape('\n\r\t')).toBe('\\n\\r\\t')
  })

  it('should return empty string for null input', () => {
    expect(escape(null as unknown as string)).toBe('')
  })

  it('should return empty string for undefined input', () => {
    expect(escape(undefined as unknown as string)).toBe('')
  })

  it('should return empty string for empty string input', () => {
    expect(escape('')).toBe('')
  })

  it('should return empty string for non-string input', () => {
    expect(escape(123 as unknown as string)).toBe('')
  })

  // Pass-through for normal strings
  it('should leave normal text unchanged', () => {
    expect(escape('hello world')).toBe('hello world')
  })

  it('should leave special regex characters unchanged', () => {
    expect(escape('a.b*c+d')).toBe('a.b*c+d')
  })

  it('should handle strings with no special characters', () => {
    expect(escape('abc123')).toBe('abc123')
  })
})
