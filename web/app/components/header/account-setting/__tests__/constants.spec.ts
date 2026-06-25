import {
  ACCOUNT_SETTING_MODAL_ACTION,
  ACCOUNT_SETTING_TAB,
  DEFAULT_ACCOUNT_SETTING_TAB,
  isValidSettingsTab,
} from '../constants'

describe('AccountSetting Constants', () => {
  it('should have correct ACCOUNT_SETTING_MODAL_ACTION', () => {
    expect(ACCOUNT_SETTING_MODAL_ACTION).toBe('showSettings')
  })

  it('should have correct ACCOUNT_SETTING_TAB values', () => {
    expect(ACCOUNT_SETTING_TAB.PROVIDER).toBe('provider')
    expect(ACCOUNT_SETTING_TAB.MEMBERS).toBe('members')
    expect(ACCOUNT_SETTING_TAB.ROLES_AND_PERMISSIONS).toBe('roles-and-permissions')
    expect(ACCOUNT_SETTING_TAB.PERMISSION_SET).toBe('permission-set')
    expect(ACCOUNT_SETTING_TAB.BILLING).toBe('billing')
    expect(ACCOUNT_SETTING_TAB.DATA_SOURCE).toBe('data-source')
    expect(ACCOUNT_SETTING_TAB.API_BASED_EXTENSION).toBe('custom-endpoint')
    expect(ACCOUNT_SETTING_TAB.CUSTOM).toBe('custom')
    expect(ACCOUNT_SETTING_TAB.PREFERENCES).toBe('preferences')
    expect(ACCOUNT_SETTING_TAB.LANGUAGE).toBe('language')
  })

  it('should have correct DEFAULT_ACCOUNT_SETTING_TAB', () => {
    expect(DEFAULT_ACCOUNT_SETTING_TAB).toBe(ACCOUNT_SETTING_TAB.MEMBERS)
  })

  it('isValidSettingsTab should include integrations tabs', () => {
    expect(isValidSettingsTab('roles-and-permissions')).toBe(true)
    expect(isValidSettingsTab('permission-set')).toBe(true)
    expect(isValidSettingsTab('billing')).toBe(true)
    expect(isValidSettingsTab('preferences')).toBe(true)
    expect(isValidSettingsTab('language')).toBe(true)
    expect(isValidSettingsTab('provider')).toBe(true)
    expect(isValidSettingsTab('mcp')).toBe(true)
    expect(isValidSettingsTab('agent-strategy')).toBe(true)
    expect(isValidSettingsTab('invalid')).toBe(false)
  })
})
