import { isPrivateOrLocalAddress, validateRedirectUrl } from './urlValidation'

describe('URL Validation', () => {
  describe('validateRedirectUrl', () => {
    it('should reject data: protocol', () => {
      expect(() => validateRedirectUrl('data:text/html,<script>alert(1)</script>')).toThrow(
        'Authorization URL must be HTTP or HTTPS',
      )
    })

    it('should reject file: protocol', () => {
      expect(() => validateRedirectUrl('file:///etc/passwd')).toThrow(
        'Authorization URL must be HTTP or HTTPS',
      )
    })

    it('should reject ftp: protocol', () => {
      expect(() => validateRedirectUrl('ftp://example.com')).toThrow(
        'Authorization URL must be HTTP or HTTPS',
      )
    })

    it('should reject vbscript: protocol', () => {
      expect(() => validateRedirectUrl('vbscript:msgbox(1)')).toThrow(
        'Authorization URL must be HTTP or HTTPS',
      )
    })

    it('should reject malformed URLs', () => {
      expect(() => validateRedirectUrl('not a url')).toThrow('Invalid URL')
      expect(() => validateRedirectUrl('://example.com')).toThrow('Invalid URL')
      expect(() => validateRedirectUrl('')).toThrow('Invalid URL')
    })

    it('should handle URLs with query parameters', () => {
      expect(() => validateRedirectUrl('https://example.com?param=value')).not.toThrow()
      expect(() =>
        validateRedirectUrl('https://example.com?redirect=http://evil.com'),
      ).not.toThrow()
    })

    it('should handle URLs with fragments', () => {
      expect(() => validateRedirectUrl('https://example.com#section')).not.toThrow()
      expect(() => validateRedirectUrl('https://example.com/path#fragment')).not.toThrow()
    })

    it('should handle URLs with authentication', () => {
      expect(() => validateRedirectUrl('https://user:pass@example.com')).not.toThrow()
    })

    it('should handle international domain names', () => {
      expect(() => validateRedirectUrl('https://例え.jp')).not.toThrow()
    })

    it('should reject protocol-relative URLs', () => {
      expect(() => validateRedirectUrl('//example.com')).toThrow('Invalid URL')
    })
  })

  describe('isPrivateOrLocalAddress', () => {
    it('should return true for localhost', () => {
      expect(isPrivateOrLocalAddress('http://localhost:5001')).toBe(true)
    })

    it('should return true for the IPv4 loopback', () => {
      expect(isPrivateOrLocalAddress('http://127.0.0.1/x')).toBe(true)
    })

    it('should return true for the IPv6 loopback with brackets', () => {
      expect(isPrivateOrLocalAddress('http://[::1]/x')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[::1]:5001/webhook')).toBe(true)
    })

    it('should return true for private IPv4 ranges', () => {
      expect(isPrivateOrLocalAddress('http://10.0.0.1/x')).toBe(true)
      expect(isPrivateOrLocalAddress('http://172.16.0.1/x')).toBe(true)
      expect(isPrivateOrLocalAddress('http://172.31.255.255/x')).toBe(true)
      expect(isPrivateOrLocalAddress('http://192.168.1.1/x')).toBe(true)
      expect(isPrivateOrLocalAddress('http://169.254.1.1/x')).toBe(true)
    })

    it('should return false for public IPv4 addresses', () => {
      expect(isPrivateOrLocalAddress('http://8.8.8.8/x')).toBe(false)
      expect(isPrivateOrLocalAddress('http://172.32.0.1/x')).toBe(false)
    })

    it('should return true for .local domains', () => {
      expect(isPrivateOrLocalAddress('http://myhost.local/x')).toBe(true)
    })

    it('should return false for public hostnames', () => {
      expect(isPrivateOrLocalAddress('https://example.com/x')).toBe(false)
    })

    it('should return false for invalid URLs', () => {
      expect(isPrivateOrLocalAddress('not a url')).toBe(false)
    })
  })
})
