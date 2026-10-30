import { parseVectorSpaceToMB } from '../index'

describe('billing utils', () => {
  it.each([
    ['50MB', 50],
    ['5GB', 5120],
    ['50mb', 50],
    ['5gb', 5120],
    ['50', 0],
    ['50TB', 0],
  ])('converts vector storage %s to %i MB', (value, expected) => {
    expect(parseVectorSpaceToMB(value)).toBe(expected)
  })
})
