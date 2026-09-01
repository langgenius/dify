import { describe, expect, it } from 'vitest'
import { sanitizeMarketplaceHref } from '../marketplace-href'

describe('sanitizeMarketplaceHref', () => {
  it('allows http(s) URLs and same-origin relative paths', () => {
    expect(sanitizeMarketplaceHref('https://dify.ai/blog')).toBe('https://dify.ai/blog')
    expect(sanitizeMarketplaceHref('http://localhost:3000/plugin/a/b')).toBe(
      'http://localhost:3000/plugin/a/b',
    )
    expect(sanitizeMarketplaceHref('/plugin/langgenius/dropbox')).toBe('/plugin/langgenius/dropbox')
  })

  it('rejects blank values and non-http schemes', () => {
    expect(sanitizeMarketplaceHref('')).toBeNull()
    expect(sanitizeMarketplaceHref('   ')).toBeNull()
    expect(sanitizeMarketplaceHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeMarketplaceHref('data:text/html,bad')).toBeNull()
    expect(sanitizeMarketplaceHref('mailto:test@example.com')).toBeNull()
    expect(sanitizeMarketplaceHref('//evil.example')).toBeNull()
  })
})
