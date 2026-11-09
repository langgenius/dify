import { toggleControlSpaceId } from '../config-helpers'

describe('knowledge-retrieval-v2/config-helpers', () => {
  it('adds and removes a space while preserving selection order', () => {
    expect(toggleControlSpaceId(['space-1'], 'space-2')).toEqual(['space-1', 'space-2'])
    expect(toggleControlSpaceId(['space-1', 'space-2'], 'space-1')).toEqual(['space-2'])
  })

  it('does not select more than ten spaces', () => {
    const selected = Array.from({ length: 10 }, (_, index) => `space-${index}`)

    expect(toggleControlSpaceId(selected, 'space-10')).toEqual(selected)
  })
})
