import type { inferParserType } from 'nuqs'
import { parseAsStringLiteral } from 'nuqs'
import { INTEGRATION_SECTION_VALUES } from '@/app/components/integrations/routes'
import { ACCOUNT_SETTING_TAB_VALUES } from './constants'

export const settingsQueryParamName = 'settings'

// Settings is a client-owned full-screen surface, so nuqs' shallow replace defaults are enough.
export const settingsQueryParser = parseAsStringLiteral([
  ...ACCOUNT_SETTING_TAB_VALUES,
  ...INTEGRATION_SECTION_VALUES,
] as const)

export type SettingsDestination = inferParserType<typeof settingsQueryParser>

export const isAccountSettingDestination = (
  destination: SettingsDestination | null,
): destination is (typeof ACCOUNT_SETTING_TAB_VALUES)[number] => {
  return ACCOUNT_SETTING_TAB_VALUES.some((value) => value === destination)
}

export const isIntegrationSettingDestination = (
  destination: SettingsDestination | null,
): destination is (typeof INTEGRATION_SECTION_VALUES)[number] => {
  return INTEGRATION_SECTION_VALUES.some((value) => value === destination)
}
