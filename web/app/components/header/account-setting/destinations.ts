import type { AccountSettingTab } from './constants'
import { buildIntegrationPath } from '@/app/components/tools/integration-routes'
import { ACCOUNT_SETTING_TAB } from './constants'

export const movedAccountSettingDestinations: Partial<Record<AccountSettingTab, string>> = {
  [ACCOUNT_SETTING_TAB.PROVIDER]: buildIntegrationPath('provider'),
  [ACCOUNT_SETTING_TAB.DATA_SOURCE]: buildIntegrationPath('data-source'),
  [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION]: buildIntegrationPath('api-based-extension'),
}

export const enableMovedAccountSettingDestinations = true

export const getMovedAccountSettingDestination = (tab: AccountSettingTab) => {
  if (!enableMovedAccountSettingDestinations)
    return undefined

  return movedAccountSettingDestinations[tab]
}
