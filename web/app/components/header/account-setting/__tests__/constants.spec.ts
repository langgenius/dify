import {
  ACCOUNT_SETTING_MODAL_ACTION,
  ACCOUNT_SETTING_TAB,
  DEFAULT_ACCOUNT_SETTING_TAB,
  isValidAccountSettingTab,
  isValidSettingsTab,
} from '../constants'
import {
  enableMovedAccountSettingDestinations,
  getMovedAccountSettingDestination,
  isMovedAccountSettingTab,
  movedAccountSettingDestinations,
} from '../destinations'

describe('AccountSetting Constants', () => {
  it('should have correct ACCOUNT_SETTING_MODAL_ACTION', () => {
    expect(ACCOUNT_SETTING_MODAL_ACTION).toBe('showSettings')
  })

  it('should have correct ACCOUNT_SETTING_TAB values', () => {
    expect(ACCOUNT_SETTING_TAB.PROVIDER).toBe('provider')
    expect(ACCOUNT_SETTING_TAB.MEMBERS).toBe('members')
    expect(ACCOUNT_SETTING_TAB.PERMISSIONS).toBe('permissions')
    expect(ACCOUNT_SETTING_TAB.ACCESS_RULES).toBe('access-rules')
    expect(ACCOUNT_SETTING_TAB.BILLING).toBe('billing')
    expect(ACCOUNT_SETTING_TAB.DATA_SOURCE).toBe('data-source')
    expect(ACCOUNT_SETTING_TAB.API_BASED_EXTENSION).toBe('custom-endpoint')
    expect(ACCOUNT_SETTING_TAB.CUSTOM).toBe('custom')
    expect(ACCOUNT_SETTING_TAB.PREFERENCE).toBe('preference')
    expect(ACCOUNT_SETTING_TAB.LANGUAGE).toBe('language')
  })

  it('should have correct DEFAULT_ACCOUNT_SETTING_TAB', () => {
    expect(DEFAULT_ACCOUNT_SETTING_TAB).toBe(ACCOUNT_SETTING_TAB.MEMBERS)
  })

  it('isValidAccountSettingTab should return true for valid tabs', () => {
    expect(isValidAccountSettingTab('provider')).toBe(true)
    expect(isValidAccountSettingTab('members')).toBe(true)
    expect(isValidAccountSettingTab('permissions')).toBe(true)
    expect(isValidAccountSettingTab('access-rules')).toBe(true)
    expect(isValidAccountSettingTab('billing')).toBe(true)
    expect(isValidAccountSettingTab('data-source')).toBe(true)
    expect(isValidAccountSettingTab('custom-endpoint')).toBe(true)
    expect(isValidAccountSettingTab('custom')).toBe(true)
    expect(isValidAccountSettingTab('preference')).toBe(true)
    expect(isValidAccountSettingTab('language')).toBe(true)
  })

  it('isValidAccountSettingTab should return false for invalid tabs', () => {
    expect(isValidAccountSettingTab(null)).toBe(false)
    expect(isValidAccountSettingTab('')).toBe(false)
    expect(isValidAccountSettingTab('invalid')).toBe(false)
  })

  it('isValidSettingsTab should include integrations tabs', () => {
    expect(isValidSettingsTab('permissions')).toBe(true)
    expect(isValidSettingsTab('access-rules')).toBe(true)
    expect(isValidSettingsTab('billing')).toBe(true)
    expect(isValidSettingsTab('preference')).toBe(true)
    expect(isValidSettingsTab('language')).toBe(true)
    expect(isValidSettingsTab('provider')).toBe(true)
    expect(isValidSettingsTab('mcp')).toBe(true)
    expect(isValidSettingsTab('agent-strategy')).toBe(true)
    expect(isValidSettingsTab('invalid')).toBe(false)
  })

  it('should map migrated setting tabs to integrations sections', () => {
    expect(enableMovedAccountSettingDestinations).toBe(true)
    expect(movedAccountSettingDestinations[ACCOUNT_SETTING_TAB.PROVIDER]).toBe('/integrations/model-provider')
    expect(movedAccountSettingDestinations[ACCOUNT_SETTING_TAB.DATA_SOURCE]).toBe('/integrations/data-source')
    expect(movedAccountSettingDestinations[ACCOUNT_SETTING_TAB.API_BASED_EXTENSION]).toBe('/integrations/custom-endpoint')
    expect(getMovedAccountSettingDestination(ACCOUNT_SETTING_TAB.PROVIDER)).toBe('/integrations/model-provider')
    expect(getMovedAccountSettingDestination(ACCOUNT_SETTING_TAB.DATA_SOURCE)).toBe('/integrations/data-source')
    expect(getMovedAccountSettingDestination(ACCOUNT_SETTING_TAB.API_BASED_EXTENSION)).toBe('/integrations/custom-endpoint')
    expect(isMovedAccountSettingTab(ACCOUNT_SETTING_TAB.BILLING)).toBe(false)
  })
})
