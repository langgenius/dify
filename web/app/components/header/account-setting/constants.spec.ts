import {
  ACCOUNT_SETTING_MODAL_ACTION,
  ACCOUNT_SETTING_TAB,
  DEFAULT_ACCOUNT_SETTING_TAB,
  isValidAccountSettingTab,
} from './constants'

describe('AccountSetting Constants', () => {
  it('should have correct ACCOUNT_SETTING_MODAL_ACTION', () => {
    expect(ACCOUNT_SETTING_MODAL_ACTION).toBe('showSettings')
  })

  it('should have correct ACCOUNT_SETTING_TAB values', () => {
    expect(ACCOUNT_SETTING_TAB.PROVIDER).toBe('provider')
    expect(ACCOUNT_SETTING_TAB.MEMBERS).toBe('members')
    expect(ACCOUNT_SETTING_TAB.BILLING).toBe('billing')
    expect(ACCOUNT_SETTING_TAB.DATA_SOURCE).toBe('data-source')
    expect(ACCOUNT_SETTING_TAB.API_BASED_EXTENSION).toBe('api-based-extension')
    expect(ACCOUNT_SETTING_TAB.CUSTOM).toBe('custom')
    expect(ACCOUNT_SETTING_TAB.LANGUAGE).toBe('language')
  })

  it('should have correct DEFAULT_ACCOUNT_SETTING_TAB', () => {
    expect(DEFAULT_ACCOUNT_SETTING_TAB).toBe(ACCOUNT_SETTING_TAB.MEMBERS)
  })

  it('isValidAccountSettingTab should return true for valid tabs', () => {
    expect(isValidAccountSettingTab('provider')).toBe(true)
    expect(isValidAccountSettingTab('members')).toBe(true)
    expect(isValidAccountSettingTab('billing')).toBe(true)
    expect(isValidAccountSettingTab('data-source')).toBe(true)
    expect(isValidAccountSettingTab('api-based-extension')).toBe(true)
    expect(isValidAccountSettingTab('custom')).toBe(true)
    expect(isValidAccountSettingTab('language')).toBe(true)
  })

  it('isValidAccountSettingTab should return false for invalid tabs', () => {
    expect(isValidAccountSettingTab(null)).toBe(false)
    expect(isValidAccountSettingTab('')).toBe(false)
    expect(isValidAccountSettingTab('invalid')).toBe(false)
  })
})
