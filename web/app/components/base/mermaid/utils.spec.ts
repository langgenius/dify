import { cleanUpSvgCode } from './utils'

describe('cleanUpSvgCode', () => {
  it('replaces old-style <br> tags with the new style', () => {
    const result = cleanUpSvgCode('<br>test<br>')
    expect(result).toEqual('<br/>test<br/>')
  })
})
