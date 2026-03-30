import type { Dispatch, SetStateAction } from 'react'
import type { AccountSettingTab } from '@/app/components/header/account-setting/constants'
import type { ModalState } from '@/context/modal-context'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'

export const getOpenModelProviderHandler = (
  setShowAccountSettingModal: Dispatch<SetStateAction<ModalState<AccountSettingTab> | null>>,
) => {
  return () => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MODEL_PROVIDER })
}
