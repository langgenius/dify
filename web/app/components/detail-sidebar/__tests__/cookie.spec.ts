import { parseDetailSidebarMode } from '../cookie'

describe('detail sidebar cookie', () => {
  it.each([
    ['collapse', 'collapse'],
    ['expand', 'expand'],
    ['unexpected', 'expand'],
    [undefined, 'expand'],
  ] as const)('parses %s as %s', (value, expected) => {
    expect(parseDetailSidebarMode(value)).toBe(expected)
  })
})
