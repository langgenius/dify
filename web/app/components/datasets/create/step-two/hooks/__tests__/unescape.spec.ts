import { describe, expect, it } from 'vitest'
import unescape from '../unescape'

describe('unescape', () => {
  // Basic escape sequences
  it('should unescape \\n to newline', () => {
    expect(unescape('\\n')).toBe('\n')
  })

  it('should unescape \\t to tab', () => {
    expect(unescape('\\t')).toBe('\t')
  })

  it('should unescape \\r to carriage return', () => {
    expect(unescape('\\r')).toBe('\r')
  })

  it('should unescape \\b to backspace', () => {
    expect(unescape('\\b')).toBe('\b')
  })

  it('should unescape \\f to form feed', () => {
    expect(unescape('\\f')).toBe('\f')
  })

  it('should unescape \\v to vertical tab', () => {
    expect(unescape('\\v')).toBe('\v')
  })

  it('should unescape \\0 to null character', () => {
    expect(unescape('\\0')).toBe('\0')
  })

  it('should unescape \\\\ to backslash', () => {
    expect(unescape('\\\\')).toBe('\\')
  })

  it('should unescape \\\'  to single quote', () => {
    expect(unescape('\\\'')).toBe('\'')
  })

  it('should unescape \\" to double quote', () => {
    expect(unescape('\\"')).toBe('"')
  })

  // Hex escape sequences (\\xNN)
  it('should unescape 2-digit hex sequences', () => {
    expect(unescape('\\x41')).toBe('A')
    expect(unescape('\\x61')).toBe('a')
  })

  // Unicode escape sequences (\\uNNNN)
  it('should unescape 4-digit unicode sequences', () => {
    expect(unescape('\\u0041')).toBe('A')
    expect(unescape('\\u4e2d')).toBe('中')
  })

  // Variable-length unicode (\\u{NNNN})
  it('should unescape variable-length unicode sequences', () => {
    expect(unescape('\\u{41}')).toBe('A')
    expect(unescape('\\u{1F600}')).toBe('😀')
  })

  // Octal escape sequences
  it('should unescape octal sequences', () => {
    expect(unescape('\\101')).toBe('A') // 0o101 = 65 = 'A'
    expect(unescape('\\12')).toBe('\n') // 0o12 = 10 = '\n'
  })

  // Python-style 8-digit unicode (\\UNNNNNNNN)
  it('should unescape Python-style 8-digit unicode', () => {
    expect(unescape('\\U0001F3B5')).toBe('🎵')
  })

  // Multiple escape sequences
  it('should unescape multiple sequences in one string', () => {
    expect(unescape('line1\\nline2\\ttab')).toBe('line1\nline2\ttab')
  })

  // Mixed content
  it('should leave non-escape content unchanged', () => {
    expect(unescape('hello world')).toBe('hello world')
  })

  it('should handle mixed escaped and non-escaped content', () => {
    expect(unescape('before\\nafter')).toBe('before\nafter')
  })

  it('should handle empty string', () => {
    expect(unescape('')).toBe('')
  })

  it('should handle string with no escape sequences', () => {
    expect(unescape('abc123')).toBe('abc123')
  })
})
