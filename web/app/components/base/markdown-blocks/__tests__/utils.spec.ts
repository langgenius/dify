import { getMarkdownImageURL, isValidUrl } from '../utils'

vi.mock('@/config', () => ({
  ALLOW_UNSAFE_DATA_SCHEME: false,
  MARKETPLACE_API_PREFIX: '/api/marketplace',
}))

describe('utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isValidUrl', () => {
    it('should return true for http: URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true)
    })

    it('should return true for https: URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true)
    })

    it('should return true for protocol-relative URLs', () => {
      expect(isValidUrl('//cdn.example.com/image.png')).toBe(true)
    })

    it('should return true for mailto: URLs', () => {
      expect(isValidUrl('mailto:user@example.com')).toBe(true)
    })

    it('should return false for data: URLs when ALLOW_UNSAFE_DATA_SCHEME is false', () => {
      expect(isValidUrl('data:image/png;base64,abc123')).toBe(false)
    })

    it('should return false for javascript: URLs', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false)
    })

    it('should return false for ftp: URLs', () => {
      expect(isValidUrl('ftp://files.example.com')).toBe(false)
    })

    it('should return false for relative paths', () => {
      expect(isValidUrl('/images/photo.png')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isValidUrl('')).toBe(false)
    })

    it('should return false for plain text', () => {
      expect(isValidUrl('not a url')).toBe(false)
    })
  })

  describe('isValidUrl with ALLOW_UNSAFE_DATA_SCHEME enabled', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.doMock('@/config', () => ({
        ALLOW_UNSAFE_DATA_SCHEME: true,
        MARKETPLACE_API_PREFIX: '/api/marketplace',
      }))
    })

    it('should return true for data: URLs when ALLOW_UNSAFE_DATA_SCHEME is true', async () => {
      const { isValidUrl: isValidUrlWithData } = await import('../utils')
      expect(isValidUrlWithData('data:image/png;base64,abc123')).toBe(true)
    })
  })

  describe('getMarkdownImageURL', () => {
    it('should return the original URL when it does not match the asset regex', () => {
      expect(getMarkdownImageURL('https://example.com/image.png')).toBe('https://example.com/image.png')
    })

    it('should transform ./_assets URL without pathname', () => {
      const result = getMarkdownImageURL('./_assets/icon.png')
      expect(result).toBe('/api/marketplace/plugins//_assets/icon.png')
    })

    it('should transform ./_assets URL with pathname', () => {
      const result = getMarkdownImageURL('./_assets/icon.png', 'my-plugin/')
      expect(result).toBe('/api/marketplace/plugins/my-plugin//_assets/icon.png')
    })

    it('should transform _assets URL without leading dot-slash', () => {
      const result = getMarkdownImageURL('_assets/logo.svg')
      expect(result).toBe('/api/marketplace/plugins//_assets/logo.svg')
    })

    it('should transform _assets URL with pathname', () => {
      const result = getMarkdownImageURL('_assets/logo.svg', 'org/plugin/')
      expect(result).toBe('/api/marketplace/plugins/org/plugin//_assets/logo.svg')
    })

    it('should not transform URLs that contain _assets in the middle', () => {
      expect(getMarkdownImageURL('https://cdn.example.com/_assets/image.png'))
        .toBe('https://cdn.example.com/_assets/image.png')
    })

    it('should use empty string for pathname when undefined', () => {
      const result = getMarkdownImageURL('./_assets/test.png')
      expect(result).toBe('/api/marketplace/plugins//_assets/test.png')
    })
  })

  describe('getMarkdownImageURL with trailing slash prefix', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.doMock('@/config', () => ({
        ALLOW_UNSAFE_DATA_SCHEME: false,
        MARKETPLACE_API_PREFIX: '/api/marketplace/',
      }))
    })

    it('should not add extra slash when prefix ends with slash', async () => {
      const { getMarkdownImageURL: getURL } = await import('../utils')
      const result = getURL('./_assets/icon.png', 'my-plugin/')
      expect(result).toBe('/api/marketplace/plugins/my-plugin//_assets/icon.png')
    })
  })
})
