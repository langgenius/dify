import { describe, expect, it } from 'vitest'
import { appendSearchParams, joinURL } from './url.js'

describe('joinURL', () => {
  it('joins base and path with single slash', () => {
    expect(joinURL('https://api.example.com/openapi/v1', 'workspaces')).toBe('https://api.example.com/openapi/v1/workspaces')
  })

  it('collapses double slash when base has trailing and path has leading', () => {
    expect(joinURL('https://api.example.com/openapi/v1/', '/workspaces')).toBe('https://api.example.com/openapi/v1/workspaces')
  })

  it('inserts slash when neither side has one', () => {
    expect(joinURL('https://api.example.com', 'workspaces')).toBe('https://api.example.com/workspaces')
  })

  it('preserves trailing-only or leading-only slash without adding another', () => {
    expect(joinURL('https://api.example.com/', 'workspaces')).toBe('https://api.example.com/workspaces')
    expect(joinURL('https://api.example.com', '/workspaces')).toBe('https://api.example.com/workspaces')
  })

  it('returns base when path is empty or root', () => {
    expect(joinURL('https://api.example.com', '')).toBe('https://api.example.com')
    expect(joinURL('https://api.example.com', '/')).toBe('https://api.example.com')
  })

  it('returns path when base is empty or root', () => {
    expect(joinURL('', 'workspaces')).toBe('workspaces')
    expect(joinURL('/', 'workspaces')).toBe('workspaces')
  })
})

describe('appendSearchParams', () => {
  it('returns the URL unchanged when params is undefined', () => {
    expect(appendSearchParams('https://x/y', undefined)).toBe('https://x/y')
  })

  it('returns the URL unchanged when every value is undefined', () => {
    expect(appendSearchParams('https://x/y', { a: undefined, b: undefined })).toBe('https://x/y')
  })

  it('omits undefined values and coerces primitives', () => {
    const url = appendSearchParams('https://x/y', { page: 2, active: true, name: 'foo', skip: undefined })
    expect(url).toBe('https://x/y?page=2&active=true&name=foo')
  })

  it('uses & when the URL already has a query string', () => {
    expect(appendSearchParams('https://x/y?a=1', { b: 2 })).toBe('https://x/y?a=1&b=2')
  })

  // Pins the convention documented on `appendSearchParams`: callers that mean
  // "absent" pass `undefined`; an explicit empty string travels as `?key=`.
  // API-client callers collapse empties to `undefined` upstream — this is the
  // backstop that catches a future "let's just skip empties here too" change.
  it('keeps empty-string values on the wire (only undefined is skipped)', () => {
    expect(appendSearchParams('https://x/y', { name: '', tag: undefined })).toBe('https://x/y?name=')
  })
})
