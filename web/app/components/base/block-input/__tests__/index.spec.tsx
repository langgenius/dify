import { getInputKeys } from '../index'

describe('getInputKeys', () => {
  it('extracts unique variable keys in their first appearance order', () => {
    expect(getInputKeys('Hello {{user_1}}, {{name}}, {{user_1}} and {{user_2}}')).toEqual([
      'user_1',
      'name',
      'user_2',
    ])
  })

  it.each(['plain text', ''])('returns no keys for %j', (input) => {
    expect(getInputKeys(input)).toEqual([])
  })
})
