import { generateMailToLink, mailToSupport } from '../util'

describe('generateMailToLink', () => {
  // Email-only: both subject and body branches false
  it('should return mailto link with email only when no subject or body provided', () => {
    // Act
    const result = generateMailToLink('test@example.com')

    // Assert
    expect(result).toBe('mailto:test@example.com')
  })

  // Subject provided, body not: subject branch true, body branch false
  it('should append subject when subject is provided without body', () => {
    // Act
    const result = generateMailToLink('test@example.com', 'Hello World')

    // Assert
    expect(result).toBe('mailto:test@example.com?subject=Hello%20World')
  })

  // Body provided, no subject: subject branch false, body branch true
  it('should append body with question mark when body is provided without subject', () => {
    // Act
    const result = generateMailToLink('test@example.com', undefined, 'Some body text')

    // Assert
    expect(result).toBe('mailto:test@example.com&body=Some%20body%20text')
  })

  // Both subject and body provided: both branches true
  it('should append both subject and body when both are provided', () => {
    // Act
    const result = generateMailToLink('test@example.com', 'Subject', 'Body text')

    // Assert
    expect(result).toBe('mailto:test@example.com?subject=Subject&body=Body%20text')
  })
})

describe('mailToSupport', () => {
  // Transitive coverage: exercises generateMailToLink with all params
  it('should generate a mailto link with support recipient, plan, account, and version info', () => {
    // Act
    const result = mailToSupport('user@test.com', 'Pro', '1.0.0')

    // Assert
    expect(result.startsWith('mailto:support@dify.ai?')).toBe(true)

    const query = result.split('?')[1]
    expect(query).toBeDefined()

    const params = new URLSearchParams(query)
    expect(params.get('subject')).toBe('Technical Support Request Pro user@test.com')

    const body = params.get('body')
    expect(body).toContain('Current Plan: Pro')
    expect(body).toContain('Account: user@test.com')
    expect(body).toContain('Version: 1.0.0')
  })
})
