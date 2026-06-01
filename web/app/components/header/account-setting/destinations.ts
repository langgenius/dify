import type { AccountSettingTab } from './constants'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { ACCOUNT_SETTING_TAB } from './constants'

export const integrationSectionByMovedAccountSettingTab = {
  [ACCOUNT_SETTING_TAB.PROVIDER]: 'provider',
  [ACCOUNT_SETTING_TAB.DATA_SOURCE]: 'data-source',
  [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION]: 'custom-endpoint',
} as const satisfies Partial<Record<AccountSettingTab, IntegrationSection>>

export const movedAccountSettingDestinations = {
  [ACCOUNT_SETTING_TAB.PROVIDER]: buildIntegrationPath('provider'),
  [ACCOUNT_SETTING_TAB.DATA_SOURCE]: buildIntegrationPath('data-source'),
  [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION]: buildIntegrationPath('custom-endpoint'),
} as const satisfies Partial<Record<AccountSettingTab, string>>

export type MovedAccountSettingTab = keyof typeof movedAccountSettingDestinations

export const enableMovedAccountSettingDestinations = true

export const isMovedAccountSettingTab = (tab: AccountSettingTab): tab is MovedAccountSettingTab => {
  return tab in movedAccountSettingDestinations
}

export const getMovedAccountSettingDestination = (tab: MovedAccountSettingTab) => {
  if (!enableMovedAccountSettingDestinations)
    return undefined

  return movedAccountSettingDestinations[tab]
}
