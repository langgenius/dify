import { buildProviderQuery } from './_tools_util'

describe('makeProviderQuery', () => {
  test('collectionName without special chars', () => {
    expect(buildProviderQuery('ABC')).toBe('provider=ABC')
  })
  test('should escape &', () => {
    expect(buildProviderQuery('ABC&DEF')).toBe('provider=ABC%26DEF')
  })
  test('should escape /', () => {
    expect(buildProviderQuery('ABC/DEF')).toBe('provider=ABC%2FDEF')
  })
  test('should escape ?', () => {
    expect(buildProviderQuery('ABC?DEF')).toBe('provider=ABC%3FDEF')
  })
})

describe('Tools Utilities', () => {
  describe('buildProviderQuery', () => {
    it('should build query string with provider parameter', () => {
      const result = buildProviderQuery('openai')
      expect(result).toBe('provider=openai')
    })

    it('should handle provider names with special characters', () => {
      const result = buildProviderQuery('provider-name')
      expect(result).toBe('provider=provider-name')
    })

    it('should handle empty string', () => {
      const result = buildProviderQuery('')
      expect(result).toBe('provider=')
    })

    it('should URL encode special characters', () => {
      const result = buildProviderQuery('provider name')
      expect(result).toBe('provider=provider+name')
    })

    it('should handle Unicode characters', () => {
      const result = buildProviderQuery('提供者')
      expect(result).toContain('provider=')
      expect(decodeURIComponent(result)).toBe('provider=提供者')
    })

    it('should handle provider names with slashes', () => {
      const result = buildProviderQuery('langgenius/openai/gpt-4')
      expect(result).toContain('provider=')
      expect(decodeURIComponent(result)).toBe('provider=langgenius/openai/gpt-4')
    })
  })
})
