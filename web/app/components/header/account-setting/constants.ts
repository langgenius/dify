import type { IntegrationSection } from '@/app/components/integrations/routes'
import { INTEGRATION_SECTION_VALUES } from '@/app/components/integrations/routes'

export const ACCOUNT_SETTING_MODAL_ACTION = 'showSettings'

export const ACCOUNT_SETTING_TAB = {
  PROVIDER: 'provider',
  MEMBERS: 'members',
  PERMISSIONS: 'permissions',
  ACCESS_RULES: 'access-rules',
  BILLING: 'billing',
  DATA_SOURCE: 'data-source',
  API_BASED_EXTENSION: 'custom-endpoint',
  CUSTOM: 'custom',
  PREFERENCES: 'preferences',
  LANGUAGE: 'language',
} as const

export type AccountSettingTab = typeof ACCOUNT_SETTING_TAB[keyof typeof ACCOUNT_SETTING_TAB]

export const DEFAULT_ACCOUNT_SETTING_TAB = ACCOUNT_SETTING_TAB.MEMBERS

const WORKSPACE_SETTING_TAB_VALUES = [
  ACCOUNT_SETTING_TAB.MEMBERS,
  ACCOUNT_SETTING_TAB.PERMISSIONS,
  ACCOUNT_SETTING_TAB.ACCESS_RULES,
  ACCOUNT_SETTING_TAB.BILLING,
  ACCOUNT_SETTING_TAB.CUSTOM,
] as const

export type WorkspaceSettingTab = typeof WORKSPACE_SETTING_TAB_VALUES[number]

const USER_SETTING_TAB_VALUES = [
  ACCOUNT_SETTING_TAB.PREFERENCES,
  ACCOUNT_SETTING_TAB.LANGUAGE,
] as const

export type UserSettingTab = typeof USER_SETTING_TAB_VALUES[number]

export type IntegrationSettingTab = IntegrationSection

export const SETTINGS_TAB_VALUES = [
  ...WORKSPACE_SETTING_TAB_VALUES,
  ...USER_SETTING_TAB_VALUES,
  ...INTEGRATION_SECTION_VALUES,
] as const

export type SettingsTab = typeof SETTINGS_TAB_VALUES[number]
export const isValidSettingsTab = (tab: string | null): tab is SettingsTab => {
  if (!tab)
    return false
  return SETTINGS_TAB_VALUES.includes(tab as SettingsTab)
}

export const isWorkspaceSettingTab = (tab: SettingsTab | null): tab is WorkspaceSettingTab => {
  if (!tab)
    return false
  return WORKSPACE_SETTING_TAB_VALUES.includes(tab as WorkspaceSettingTab)
}

export const isUserSettingTab = (tab: SettingsTab | null): tab is UserSettingTab => {
  if (!tab)
    return false
  return USER_SETTING_TAB_VALUES.includes(tab as UserSettingTab)
}

export const isIntegrationSettingTab = (tab: SettingsTab | null): tab is IntegrationSettingTab => {
  if (!tab)
    return false
  return INTEGRATION_SECTION_VALUES.includes(tab as IntegrationSection)
}
