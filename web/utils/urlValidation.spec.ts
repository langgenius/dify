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
    it('should identify localhost and loopback IPv4', () => {
      expect(isPrivateOrLocalAddress('http://localhost')).toBe(true)
      expect(isPrivateOrLocalAddress('http://localhost:3000')).toBe(true)
      expect(isPrivateOrLocalAddress('http://127.0.0.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://127.0.0.1:8080/api')).toBe(true)
      expect(isPrivateOrLocalAddress('http://app.localhost')).toBe(true)
    })

    it('should identify IPv6 loopback and private ranges with and without brackets', () => {
      expect(isPrivateOrLocalAddress('http://[::1]')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[::1]:8080/api')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[0:0:0:0:0:0:0:1]:3000')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[fe80::1ff:fe23:4567:890a]')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[fc00::1]')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[fd12:3456:789a:1::1]')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[::ffff:127.0.0.1]')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[::ffff:192.168.1.100]')).toBe(true)
    })

    it('should identify private IPv4 ranges', () => {
      expect(isPrivateOrLocalAddress('http://10.0.0.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://172.16.0.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://172.31.255.255')).toBe(true)
      expect(isPrivateOrLocalAddress('http://192.168.1.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://169.254.169.254')).toBe(true)
      expect(isPrivateOrLocalAddress('http://service.local')).toBe(true)
    })

    it('should return false for public addresses', () => {
      expect(isPrivateOrLocalAddress('https://google.com')).toBe(false)
      expect(isPrivateOrLocalAddress('https://api.github.com/events')).toBe(false)
      expect(isPrivateOrLocalAddress('http://8.8.8.8')).toBe(false)
      expect(isPrivateOrLocalAddress('http://1.1.1.1:53')).toBe(false)
      expect(isPrivateOrLocalAddress('http://[2001:4860:4860::8888]')).toBe(false)
    })
  })
})
