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

  // Regression for langgenius/dify#41865: isPrivateOrLocalAddress used to compare
  // URL.hostname against '::1' but the WHATWG URL parser keeps the surrounding
  // brackets for IPv6 literals, so the IPv6 branch was unreachable. Same for the
  // loopback IPv4 range beyond 127.0.0.1, and for 0.0.0.0 (unspecified).
  describe('isPrivateOrLocalAddress', () => {
    it.each([
      ['http://127.0.0.1', true], // IPv4 loopback (already worked)
      ['http://127.0.0.2', true], // 127.0.0.0/8 beyond .1
      ['http://127.255.255.254', true], // 127.0.0.0/8 upper bound
      ['http://0.0.0.0', true], // unspecified address
      ['http://10.0.0.1', true], // 10.0.0.0/8 (already worked)
      ['http://172.16.0.1', true], // 172.16.0.0/12 (already worked)
      ['http://172.31.255.254', true], // 172.16.0.0/12 upper bound
      ['http://192.168.0.1', true], // 192.168.0.0/16 (already worked)
      ['http://169.254.0.1', true], // link-local
      ['http://[::1]:8080/x', true], // IPv6 loopback (NEW)
      ['http://[fd00::1]/x', true], // IPv6 unique-local fd00::/8 (NEW)
      ['http://[fc00::1]/x', true], // IPv6 unique-local fc00::/7
      ['http://[fe80::1]/x', true], // IPv6 link-local fe80::/10
      ['http://localhost/foo', true], // DNS localhost (already worked)
      ['http://myhost.local/x', true], // mDNS .local domain (already worked)
      ['http://8.8.8.8/x', false], // public IPv4
      ['http://[2001:db8::1]/x', false], // public IPv6
      ['http://example.com/x', false], // public DNS name
    ])('flags %s as private/local=%s', (url: string, expected: boolean) => {
      expect(isPrivateOrLocalAddress(url)).toBe(expected)
    })

    it('returns false for malformed URLs (does not throw)', () => {
      expect(isPrivateOrLocalAddress('not a url')).toBe(false)
      expect(isPrivateOrLocalAddress('')).toBe(false)
    })
  })
})
