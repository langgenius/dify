'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { createContext, useContext } from 'use-context-selector'
import AccountSetting from '@/app/components/header/account-setting'
import ApiBasedExtensionModal from '@/app/components/header/account-setting/api-based-extension-page/modal'
import type { ApiBasedExtensionData } from '@/app/components/header/account-setting/api-based-extension-page/modal'

export type AccountSettingState = {
  activeTab?: string
  onCancelCallback?: () => void
}

const ModalContext = createContext<{
  setShowAccountSettingModal: Dispatch<SetStateAction<AccountSettingState | null>>
  setShowApiBasedExtensionModal: Dispatch<SetStateAction<ApiBasedExtensionData | null>>
}>({
  setShowAccountSettingModal: () => {},
  setShowApiBasedExtensionModal: () => {},
})

export const useModalContext = () => useContext(ModalContext)

type ModalContextProviderProps = {
  children: React.ReactNode
}
export const ModalContextProvider = ({
  children,
}: ModalContextProviderProps) => {
  const [showAccountSettingModal, setShowAccountSettingModal] = useState<AccountSettingState | null>(null)
  const [showApiBasedExtensionModal, setShowApiBasedExtensionModal] = useState<ApiBasedExtensionData | null>(null)

  const handleCancelAccountSettingModal = () => {
    setShowAccountSettingModal(null)

    if (showAccountSettingModal?.onCancelCallback)
      showAccountSettingModal?.onCancelCallback()
  }

  return (
    <ModalContext.Provider value={{
      setShowAccountSettingModal,
      setShowApiBasedExtensionModal,
    }}>
      <>
        {children}
        {
          !!showAccountSettingModal && (
            <AccountSetting
              activeTab={showAccountSettingModal.activeTab}
              onCancel={handleCancelAccountSettingModal}
            />
          )
        }
        {
          !!showApiBasedExtensionModal && (
            <ApiBasedExtensionModal
              data={showApiBasedExtensionModal}
              onCancel={() => setShowApiBasedExtensionModal(null)}
            />
          )
        }
      </>
    </ModalContext.Provider>
  )
}

export default ModalContext
