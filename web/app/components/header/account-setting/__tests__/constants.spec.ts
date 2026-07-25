import { isValidSettingsTab } from '../constants'

describe('isValidSettingsTab', () => {
  it.each([
    ['roles-and-permissions', true],
    ['preferences', true],
    ['provider', true],
    ['mcp', true],
    ['agent-strategy', true],
    ['invalid', false],
    [null, false],
  ])('validates %s', (tab, expected) => {
    expect(isValidSettingsTab(tab)).toBe(expected)
  })
})
