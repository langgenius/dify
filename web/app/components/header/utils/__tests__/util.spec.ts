import { generateMailToLink, mailToSupport } from '../util'

describe('generateMailToLink', () => {
  it('should return mailto link with email only when no subject or body provided', () => {
    const result = generateMailToLink('test@example.com')

    expect(result).toBe('mailto:test@example.com')
  })
})

describe('mailToSupport', () => {
  it('encodes support context without allowing it to introduce extra query parameters', () => {
    const result = mailToSupport('user+support@test.com', 'Pro & Team', '1.0.0')

    expect(result.startsWith('mailto:support@dify.ai?')).toBe(true)

    const query = result.split('?')[1]
    expect(query).toBeDefined()

    const params = new URLSearchParams(query)
    expect(params.get('subject')).toBe('Technical Support Request Pro & Team user+support@test.com')

    const body = params.get('body')
    expect(body).toContain('Current Plan: Pro & Team')
    expect(body).toContain('Account: user+support@test.com')
    expect(body).toContain('Version: 1.0.0')
    expect([...params.keys()]).toEqual(['subject', 'body'])
  })
})
