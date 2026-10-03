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
    it('should detect IPv6 loopback and unspecified addresses', () => {
      expect(isPrivateOrLocalAddress('http://[::1]:8080/webhook')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[0:0:0:0:0:0:0:1]/')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[::]/')).toBe(true)
    })

    it('should detect IPv6 unique local and link-local ranges', () => {
      expect(isPrivateOrLocalAddress('http://[fc00::1]/')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[fd00::1]/')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[FD00::1]/')).toBe(true)
      expect(isPrivateOrLocalAddress('http://[fe80::1]/')).toBe(true)
    })

    it('should detect the whole 127.0.0.0/8 loopback range', () => {
      expect(isPrivateOrLocalAddress('http://127.0.0.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://127.0.0.2')).toBe(true)
      expect(isPrivateOrLocalAddress('http://127.1.2.3:5001')).toBe(true)
    })

    it('should detect the unspecified IPv4 address', () => {
      expect(isPrivateOrLocalAddress('http://0.0.0.0')).toBe(true)
    })

    it('should detect localhost and .local domains', () => {
      expect(isPrivateOrLocalAddress('http://localhost:3000')).toBe(true)
      expect(isPrivateOrLocalAddress('http://my-box.local')).toBe(true)
    })

    it('should detect private IPv4 ranges', () => {
      expect(isPrivateOrLocalAddress('http://10.1.2.3')).toBe(true)
      expect(isPrivateOrLocalAddress('http://172.16.0.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://172.31.255.254')).toBe(true)
      expect(isPrivateOrLocalAddress('http://192.168.1.1')).toBe(true)
      expect(isPrivateOrLocalAddress('http://169.254.1.1')).toBe(true)
    })

    it('should not flag public addresses', () => {
      expect(isPrivateOrLocalAddress('https://example.com')).toBe(false)
      expect(isPrivateOrLocalAddress('https://8.8.8.8')).toBe(false)
      expect(isPrivateOrLocalAddress('http://172.15.0.1')).toBe(false)
      expect(isPrivateOrLocalAddress('http://172.32.0.1')).toBe(false)
      expect(isPrivateOrLocalAddress('http://[2001:db8::1]/')).toBe(false)
    })

    it('should return false for malformed URLs', () => {
      expect(isPrivateOrLocalAddress('not a url')).toBe(false)
      expect(isPrivateOrLocalAddress('')).toBe(false)
    })
  })
})
