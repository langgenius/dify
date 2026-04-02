import { PREVIEW_ROW_LIMIT } from '../constants'

describe('sqlite preview constants', () => {
  it('should expose the preview row limit', () => {
    expect(PREVIEW_ROW_LIMIT).toBe(1000)
  })
})
