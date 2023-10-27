'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { createContext, useContext } from 'use-context-selector'
import AccountSetting from '@/app/components/header/account-setting'
import ApiBasedExtensionModal from '@/app/components/header/account-setting/api-based-extension-page/modal'
import ModerationSettingModal from '@/app/components/app/configuration/toolbox/moderation/moderation-setting-modal'
import type { ApiBasedExtensionData } from '@/app/components/header/account-setting/api-based-extension-page/modal'
import type { ModerationConfig } from '@/models/debug'

export type AccountSettingState = {
  activeTab?: string
  onCancelCallback?: () => void
}

export type ModerationSettingModalState = {
  moderationConfig: ModerationConfig
  onCancelCallback?: () => void
  onSaveCallback: (newModerationConfig: ModerationConfig) => void
}

const ModalContext = createContext<{
  setShowAccountSettingModal: Dispatch<SetStateAction<AccountSettingState | null>>
  setShowApiBasedExtensionModal: Dispatch<SetStateAction<ApiBasedExtensionData | null>>
  setShowModerationSettingModal: Dispatch<SetStateAction<ModerationSettingModalState | null>>
}>({
  setShowAccountSettingModal: () => {},
  setShowApiBasedExtensionModal: () => {},
  setShowModerationSettingModal: () => {},
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
  const [showModerationSettingModal, setShowModerationSettingModal] = useState<ModerationSettingModalState | null>(null)

  const handleCancelAccountSettingModal = () => {
    setShowAccountSettingModal(null)

    if (showAccountSettingModal?.onCancelCallback)
      showAccountSettingModal?.onCancelCallback()
  }

  const handleCancelModerationSettingModal = () => {
    setShowModerationSettingModal(null)

    if (showModerationSettingModal?.onCancelCallback)
      showModerationSettingModal.onCancelCallback()
  }

  const handleSaveModerationSetting = (newModerationConfig: ModerationConfig) => {
    if (showModerationSettingModal?.onSaveCallback)
      showModerationSettingModal.onSaveCallback(newModerationConfig)

    setShowModerationSettingModal(null)
  }

  return (
    <ModalContext.Provider value={{
      setShowAccountSettingModal,
      setShowApiBasedExtensionModal,
      setShowModerationSettingModal,
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
        {
          !!showModerationSettingModal && (
            <ModerationSettingModal
              data={showModerationSettingModal.moderationConfig}
              onCancel={handleCancelModerationSettingModal}
              onSave={handleSaveModerationSetting}
            />
          )
        }
      </>
    </ModalContext.Provider>
  )
}

export default ModalContext
