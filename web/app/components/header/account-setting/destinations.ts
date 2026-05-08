import type { AccountSettingTab } from './constants'
import { ACCOUNT_SETTING_TAB } from './constants'

export const movedAccountSettingDestinations: Partial<Record<AccountSettingTab, string>> = {
  [ACCOUNT_SETTING_TAB.PROVIDER]: '/tools?section=provider',
  [ACCOUNT_SETTING_TAB.DATA_SOURCE]: '/tools?section=data-source',
  [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION]: '/tools?section=api-based-extension',
}

export const enableMovedAccountSettingDestinations = true

export const getMovedAccountSettingDestination = (tab: AccountSettingTab) => {
  if (!enableMovedAccountSettingDestinations)
    return undefined

  return movedAccountSettingDestinations[tab]
}
