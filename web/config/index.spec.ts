import { validPassword } from './index'

describe('validPassword Tests', () => {
  const passwordRegex = validPassword

  // Valid passwords
  test('Valid passwords: contains letter+digit, length ≥8', () => {
    expect(passwordRegex.test('password1')).toBe(true)
    expect(passwordRegex.test('PASSWORD1')).toBe(true)
    expect(passwordRegex.test('12345678a')).toBe(true)
    expect(passwordRegex.test('a1b2c3d4')).toBe(true)
    expect(passwordRegex.test('VeryLongPassword123')).toBe(true)
    expect(passwordRegex.test('short1')).toBe(false)
  })

  // Missing letter
  test('Invalid passwords: missing letter', () => {
    expect(passwordRegex.test('12345678')).toBe(false)
    expect(passwordRegex.test('!@#$%^&*123')).toBe(false)
  })

  // Missing digit
  test('Invalid passwords: missing digit', () => {
    expect(passwordRegex.test('password')).toBe(false)
    expect(passwordRegex.test('PASSWORD')).toBe(false)
    expect(passwordRegex.test('AbCdEfGh')).toBe(false)
  })

  // Too short
  test('Invalid passwords: less than 8 characters', () => {
    expect(passwordRegex.test('pass1')).toBe(false)
    expect(passwordRegex.test('abc123')).toBe(false)
    expect(passwordRegex.test('1a')).toBe(false)
  })

  // Boundary test
  test('Boundary test: exactly 8 characters', () => {
    expect(passwordRegex.test('abc12345')).toBe(true)
    expect(passwordRegex.test('1abcdefg')).toBe(true)
  })

  // Special characters
  test('Special characters: non-whitespace special chars allowed', () => {
    expect(passwordRegex.test('pass@123')).toBe(true)
    expect(passwordRegex.test('p@$$w0rd')).toBe(true)
    expect(passwordRegex.test('!1aBcDeF')).toBe(true)
  })

  // Contains whitespace
  test('Invalid passwords: contains whitespace', () => {
    expect(passwordRegex.test('pass word1')).toBe(false)
    expect(passwordRegex.test('password1 ')).toBe(false)
    expect(passwordRegex.test(' password1')).toBe(false)
    expect(passwordRegex.test('pass\tword1')).toBe(false)
  })
})
