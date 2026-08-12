import { describe, expect, it } from 'vitest'
import { createEmailRecipient, hasEmailDelimiter, mergeEmailRecipients } from '../email-recipients'

describe('email recipients', () => {
  it('should normalize an address while preserving browser email validity semantics', () => {
    expect(createEmailRecipient('  Person@Example  ')).toEqual({
      value: 'person@example',
      isValid: true,
    })
    expect(createEmailRecipient('not-an-email')).toEqual({
      value: 'not-an-email',
      isValid: false,
    })
  })

  it.each([',', ';', '\n', '\r\n', '\t'])(
    'should recognize %j as a batch paste separator',
    (separator) => {
      expect(hasEmailDelimiter(`first@example.com${separator}second@example.com`)).toBe(true)
    },
  )

  it.each(['first@example.com', 'first@example.com second@example.com'])(
    'should not treat %j as batch input',
    (value) => {
      expect(hasEmailDelimiter(value)).toBe(false)
    },
  )

  it('should ignore empty entries while preserving recipient order', () => {
    expect(mergeEmailRecipients([], ' first@example.com, ,\nsecond@example.com;\t')).toEqual([
      { value: 'first@example.com', isValid: true },
      { value: 'second@example.com', isValid: true },
    ])
  })

  it('should deduplicate recipients against both existing and pasted addresses', () => {
    const existing = [createEmailRecipient('first@example.com')]

    expect(
      mergeEmailRecipients(existing, 'FIRST@example.com, second@example.com, SECOND@example.com'),
    ).toEqual([
      { value: 'first@example.com', isValid: true },
      { value: 'second@example.com', isValid: true },
    ])
  })

  it('should preserve invalid pasted entries so the user can correct them', () => {
    expect(mergeEmailRecipients([], 'valid@example.com, not-an-email')).toEqual([
      { value: 'valid@example.com', isValid: true },
      { value: 'not-an-email', isValid: false },
    ])
  })

  it('should preserve the order of a realistic twenty-recipient batch', () => {
    const addresses = Array.from({ length: 20 }, (_, index) => `person-${index + 1}@example.com`)

    expect(mergeEmailRecipients([], addresses.join('\n')).map(({ value }) => value)).toEqual(
      addresses,
    )
  })
})
