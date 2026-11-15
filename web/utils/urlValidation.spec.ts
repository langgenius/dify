import { validateRedirectUrl } from './urlValidation'

describe('validateRedirectUrl', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com',
    'vbscript:msgbox(1)',
  ])('rejects a non-HTTP authorization URL: %s', (url) => {
    expect(() => validateRedirectUrl(url)).toThrow('Authorization URL must be HTTP or HTTPS')
  })

  it.each(['not a url', '', '//example.com'])('rejects invalid or non-absolute URLs: %s', (url) => {
    expect(() => validateRedirectUrl(url)).toThrow('Invalid URL')
  })

  it.each(['http://example.com', 'https://example.com?redirect=http://other.example#section'])(
    'accepts an absolute HTTP(S) URL: %s',
    (url) => expect(() => validateRedirectUrl(url)).not.toThrow(),
  )
})
