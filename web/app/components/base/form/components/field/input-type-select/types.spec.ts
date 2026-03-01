import { InputTypeEnum } from './types'

describe('InputTypeEnum', () => {
  it('should accept valid input types', () => {
    expect(InputTypeEnum.parse('text-input')).toBe('text-input')
    expect(InputTypeEnum.parse('file-list')).toBe('file-list')
  })

  it('should reject invalid input types', () => {
    expect(() => InputTypeEnum.parse('invalid-type')).toThrow()
  })
})
