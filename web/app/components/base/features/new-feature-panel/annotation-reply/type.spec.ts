import { PageType } from './type'

describe('PageType', () => {
  it('should have log and annotation values', () => {
    expect(PageType.log).toBe('log')
    expect(PageType.annotation).toBe('annotation')
  })
})
