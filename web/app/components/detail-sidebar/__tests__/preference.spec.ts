import { parseDetailSidebarMode } from '../preference'

describe('parseDetailSidebarMode', () => {
  it.each(['expand', 'collapse'] as const)('accepts the %s mode', (mode) => {
    expect(parseDetailSidebarMode(mode)).toBe(mode)
  })

  it.each([undefined, '', 'expanded', 'COLLAPSE'])('rejects %s', (raw) => {
    expect(parseDetailSidebarMode(raw)).toBeUndefined()
  })
})
