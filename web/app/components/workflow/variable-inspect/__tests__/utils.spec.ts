import { validateJSONSchema } from '../utils'

describe('validateJSONSchema', () => {
  it('accepts supported schema payloads for each structured type', () => {
    expect(validateJSONSchema(['a', 'b'], 'array[string]').success).toBe(true)
    expect(validateJSONSchema([1, 2], 'array[number]').success).toBe(true)
    expect(validateJSONSchema({ answer: ['a', 1, false] }, 'object').success).toBe(true)
    expect(validateJSONSchema([{ answer: 'ok' }], 'array[object]').success).toBe(true)
  })

  it('rejects invalid structured payloads and skips unknown types', () => {
    expect(validateJSONSchema(['a', 1], 'array[string]').success).toBe(false)
    expect(validateJSONSchema([{ answer: 'ok' }], 'array[number]').success).toBe(false)
    expect(validateJSONSchema('plain-text', 'custom').success).toBe(true)
  })
})
