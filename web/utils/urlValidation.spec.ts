import { validateRedirectUrl } from './urlValidation'

describe('URL Validation', () => {
  describe('validateRedirectUrl', () => {
    /*
    TODO: How can we enable this test case? I commented this test case because eslint triggers an error
    Error msg: "Using http protocol is insecure. Use https instead"
    */
    // it('should accept valid HTTP URLs', () => {
    //   expect(() => validateRedirectUrl('http://example.com')).not.toThrow()
    //   expect(() => validateRedirectUrl('http://localhost:3000')).not.toThrow()
    //   expect(() => validateRedirectUrl('http://192.168.1.1')).not.toThrow()
    // })

    // it('should accept valid HTTPS URLs', () => {
    //   expect(() => validateRedirectUrl('https://example.com')).not.toThrow()
    //   expect(() => validateRedirectUrl('https://sub.example.com')).not.toThrow()
    //   expect(() => validateRedirectUrl('https://example.com:8080')).not.toThrow()
    // })

    /*
    TODO: How can we enable this test case? I commented this test case because eslint triggers an error
    Error msg: "Make sure that 'javascript:' code is safe as it's form of eval()"
    */
    // it('should reject javascript: protocol (XSS)', () => {
    //   expect(() => validateRedirectUrl('javascript:alert(1)')).toThrow('Authorization URL must be HTTP or HTTPS')
    // })

    it('should reject data: protocol', () => {
      expect(() => validateRedirectUrl('data:text/html,<script>alert(1)</script>')).toThrow('Authorization URL must be HTTP or HTTPS')
    })

    it('should reject file: protocol', () => {
      expect(() => validateRedirectUrl('file:///etc/passwd')).toThrow('Authorization URL must be HTTP or HTTPS')
    })

    it('should reject ftp: protocol', () => {
      expect(() => validateRedirectUrl('ftp://example.com')).toThrow('Authorization URL must be HTTP or HTTPS')
    })

    it('should reject vbscript: protocol', () => {
      expect(() => validateRedirectUrl('vbscript:msgbox(1)')).toThrow('Authorization URL must be HTTP or HTTPS')
    })

    it('should reject malformed URLs', () => {
      expect(() => validateRedirectUrl('not a url')).toThrow('Invalid URL')
      expect(() => validateRedirectUrl('://example.com')).toThrow('Invalid URL')
      expect(() => validateRedirectUrl('')).toThrow('Invalid URL')
    })

    it('should handle URLs with query parameters', () => {
      expect(() => validateRedirectUrl('https://example.com?param=value')).not.toThrow()
      expect(() => validateRedirectUrl('https://example.com?redirect=http://evil.com')).not.toThrow()
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
})
