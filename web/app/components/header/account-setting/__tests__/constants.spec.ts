import {
  isAccountSettingDestination,
  isIntegrationSettingDestination,
  settingsQueryParser,
} from '../query-params'

describe('settingsQueryParser', () => {
  it.each([
    ['roles-and-permissions', 'roles-and-permissions'],
    ['ip-policies', 'ip-policies'],
    ['access-token', 'access-token'],
    ['preferences', 'preferences'],
    ['provider', 'provider'],
    ['mcp', 'mcp'],
    ['agent-strategy', 'agent-strategy'],
    ['file-scan', 'file-scan'],
    ['invalid', null],
    ['', null],
  ])('parses %s', (value, expected) => {
    expect(settingsQueryParser.parse(value)).toBe(expected)
  })

  it('keeps account and integration destinations in their owning branches', () => {
    expect(isAccountSettingDestination('members')).toBe(true)
    expect(isAccountSettingDestination('provider')).toBe(false)
    expect(isIntegrationSettingDestination('provider')).toBe(true)
    expect(isIntegrationSettingDestination('members')).toBe(false)
    // Malware scanners live in Integrations, not in the account settings.
    expect(isIntegrationSettingDestination('file-scan')).toBe(true)
    expect(isAccountSettingDestination('file-scan')).toBe(false)
  })
})
