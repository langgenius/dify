import { ContactMethods, UserSchema } from './types'

describe('demo scenario types', () => {
  it('should expose contact methods with capitalized labels', () => {
    expect(ContactMethods).toEqual([
      { value: 'email', label: 'Email' },
      { value: 'phone', label: 'Phone' },
      { value: 'whatsapp', label: 'Whatsapp' },
      { value: 'sms', label: 'Sms' },
    ])
  })

  it('should validate a complete user payload', () => {
    expect(UserSchema.safeParse({
      name: 'Alice',
      surname: 'Smith',
      isAcceptingTerms: true,
      contact: {
        email: 'alice@example.com',
        phone: '',
        preferredContactMethod: 'email',
      },
    }).success).toBe(true)
  })

  it('should reject invalid user payload', () => {
    const result = UserSchema.safeParse({
      name: 'alice',
      surname: 's',
      isAcceptingTerms: false,
      contact: {
        email: 'invalid',
        preferredContactMethod: 'email',
      },
    })

    expect(result.success).toBe(false)
  })
})
