import { buildProviderQuery } from './_tools_util'

describe('makeProviderQuery', () => {
  test('collectionName without special chars', () => {
    expect(buildProviderQuery('ABC')).toBe('provider=ABC')
  })
  test('should escape &', () => {
    expect(buildProviderQuery('ABC&DEF')).toBe('provider=ABC%26DEF')
  })
  test('should escape /', () => {
    expect(buildProviderQuery('ABC/DEF')).toBe('provider=ABC%2FDEF')
  })
  test('should escape ?', () => {
    expect(buildProviderQuery('ABC?DEF')).toBe('provider=ABC%3FDEF')
  })
})
