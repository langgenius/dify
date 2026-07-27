import { sanitizeKeyValueField } from './utils'

describe('http/utils sanitizeKeyValueField', () => {
  it('leaves plain single-line values untouched', () => {
    expect(sanitizeKeyValueField('application/json')).toBe('application/json')
  })

  it('replaces a single embedded newline with a space', () => {
    expect(sanitizeKeyValueField('Bearer\ntoken')).toBe('Bearer token')
  })

  it('replaces a windows-style CRLF with a single space', () => {
    expect(sanitizeKeyValueField('foo\r\nbar')).toBe('foo bar')
  })

  it('collapses multiple consecutive newlines into a single space', () => {
    expect(sanitizeKeyValueField('foo\n\n\nbar')).toBe('foo bar')
  })

  it('handles a value that is entirely newlines', () => {
    expect(sanitizeKeyValueField('\n\n')).toBe(' ')
  })

  it('handles an empty string', () => {
    expect(sanitizeKeyValueField('')).toBe('')
  })
})
