import type { AccountSettingTab } from './constants'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import { ACCOUNT_SETTING_TAB } from './constants'

export const integrationSectionByMovedAccountSettingTab = {
  [ACCOUNT_SETTING_TAB.PROVIDER]: 'provider',
  [ACCOUNT_SETTING_TAB.DATA_SOURCE]: 'data-source',
  [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION]: 'custom-endpoint',
} as const satisfies Partial<Record<AccountSettingTab, IntegrationSection>>

export type MovedAccountSettingTab = keyof typeof integrationSectionByMovedAccountSettingTab
