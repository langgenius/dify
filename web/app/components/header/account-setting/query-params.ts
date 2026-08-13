import type { inferParserType } from 'nuqs'
import { parseAsStringLiteral } from 'nuqs'
import { INTEGRATION_SECTION_VALUES } from '@/app/components/integrations/routes'
import { ACCOUNT_SETTING_TAB_VALUES } from './constants'

export const settingsQueryParamName = 'settings'

// Opening the full-screen settings surface is the common write. It creates a history entry and
// opts into a Next.js navigation so browser Back updates both the URL and the nuqs snapshot.
// Closing and switching destinations stay shallow and replace history at the modal owner.
export const settingsQueryParser = parseAsStringLiteral([
  ...ACCOUNT_SETTING_TAB_VALUES,
  ...INTEGRATION_SECTION_VALUES,
] as const).withOptions({ history: 'push', shallow: false })

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
