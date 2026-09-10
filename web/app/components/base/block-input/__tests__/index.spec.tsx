import { getInputKeys } from '../index'

describe('getInputKeys', () => {
  it('should extract keys from {{}} syntax', () => {
    const keys = getInputKeys('Hello {{name}}')
    expect(keys).toEqual(['name'])
  })

  it('should extract multiple keys', () => {
    const keys = getInputKeys('{{foo}} and {{bar}}')
    expect(keys).toEqual(['foo', 'bar'])
  })

  it('should remove duplicate keys', () => {
    const keys = getInputKeys('{{name}} and {{name}}')
    expect(keys).toEqual(['name'])
  })

  it('should return empty array for no variables', () => {
    const keys = getInputKeys('plain text')
    expect(keys).toEqual([])
  })

  it('should return empty array for empty string', () => {
    const keys = getInputKeys('')
    expect(keys).toEqual([])
  })

  it('should handle keys with underscores and numbers', () => {
    const keys = getInputKeys('{{user_1}} and {{user_2}}')
    expect(keys).toEqual(['user_1', 'user_2'])
  })
})
