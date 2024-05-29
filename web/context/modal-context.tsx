'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { createContext, useContext } from 'use-context-selector'
import { useRouter, useSearchParams } from 'next/navigation'
import AccountSetting from '@/app/components/header/account-setting'
import ApiBasedExtensionModal from '@/app/components/header/account-setting/api-based-extension-page/modal'
import ModerationSettingModal from '@/app/components/app/configuration/toolbox/moderation/moderation-setting-modal'
import ExternalDataToolModal from '@/app/components/app/configuration/tools/external-data-tool-modal'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import ModelModal from '@/app/components/header/account-setting/model-provider-page/model-modal'
import type {
  ConfigurateMethodEnum,
  CustomConfigrationModelFixedFields,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'

import Pricing from '@/app/components/billing/pricing'
import type { ModerationConfig } from '@/models/debug'
import type {
  ApiBasedExtension,
  ExternalDataTool,
} from '@/models/common'

export type ModalState<T> = {
  payload: T
  onCancelCallback?: () => void
  onSaveCallback?: (newPayload: T) => void
  onValidateBeforeSaveCallback?: (newPayload: T) => boolean
}

export type ModelModalType = {
  currentProvider: ModelProvider
  currentConfigurateMethod: ConfigurateMethodEnum
  currentCustomConfigrationModelFixedFields?: CustomConfigrationModelFixedFields
}
const ModalContext = createContext<{
  setShowAccountSettingModal: Dispatch<SetStateAction<ModalState<string> | null>>
  setShowApiBasedExtensionModal: Dispatch<SetStateAction<ModalState<ApiBasedExtension> | null>>
  setShowModerationSettingModal: Dispatch<SetStateAction<ModalState<ModerationConfig> | null>>
  setShowExternalDataToolModal: Dispatch<SetStateAction<ModalState<ExternalDataTool> | null>>
  setShowPricingModal: Dispatch<SetStateAction<any>>
  setShowAnnotationFullModal: () => void
  setShowModelModal: Dispatch<SetStateAction<ModalState<ModelModalType> | null>>
}>({
      setShowAccountSettingModal: () => { },
      setShowApiBasedExtensionModal: () => { },
      setShowModerationSettingModal: () => { },
      setShowExternalDataToolModal: () => { },
      setShowPricingModal: () => { },
      setShowAnnotationFullModal: () => { },
      setShowModelModal: () => {},
    })

export const useModalContext = () => useContext(ModalContext)

type ModalContextProviderProps = {
  children: React.ReactNode
}
export const ModalContextProvider = ({
  children,
}: ModalContextProviderProps) => {
  const [showAccountSettingModal, setShowAccountSettingModal] = useState<ModalState<string> | null>(null)
  const [showApiBasedExtensionModal, setShowApiBasedExtensionModal] = useState<ModalState<ApiBasedExtension> | null>(null)
  const [showModerationSettingModal, setShowModerationSettingModal] = useState<ModalState<ModerationConfig> | null>(null)
  const [showExternalDataToolModal, setShowExternalDataToolModal] = useState<ModalState<ExternalDataTool> | null>(null)
  const [showModelModal, setShowModelModal] = useState<ModalState<ModelModalType> | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()
  const [showPricingModal, setShowPricingModal] = useState(searchParams.get('show-pricing') === '1')
  const [showAnnotationFullModal, setShowAnnotationFullModal] = useState(false)
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

  const handleCancelExternalDataToolModal = () => {
    setShowExternalDataToolModal(null)

    if (showExternalDataToolModal?.onCancelCallback)
      showExternalDataToolModal.onCancelCallback()
  }

  const handleCancelModelModal = useCallback(() => {
    setShowModelModal(null)

    if (showModelModal?.onCancelCallback)
      showModelModal.onCancelCallback()
  }, [showModelModal])

  const handleSaveModelModal = useCallback(() => {
    if (showModelModal?.onSaveCallback)
      showModelModal.onSaveCallback(showModelModal.payload)

    setShowModelModal(null)
  }, [showModelModal])

  const handleSaveApiBasedExtension = (newApiBasedExtension: ApiBasedExtension) => {
    if (showApiBasedExtensionModal?.onSaveCallback)
      showApiBasedExtensionModal.onSaveCallback(newApiBasedExtension)

    setShowApiBasedExtensionModal(null)
  }

  const handleSaveModeration = (newModerationConfig: ModerationConfig) => {
    if (showModerationSettingModal?.onSaveCallback)
      showModerationSettingModal.onSaveCallback(newModerationConfig)

    setShowModerationSettingModal(null)
  }

  const handleSaveExternalDataTool = (newExternalDataTool: ExternalDataTool) => {
    if (showExternalDataToolModal?.onSaveCallback)
      showExternalDataToolModal.onSaveCallback(newExternalDataTool)

    setShowExternalDataToolModal(null)
  }

  const handleValidateBeforeSaveExternalDataTool = (newExternalDataTool: ExternalDataTool) => {
    if (showExternalDataToolModal?.onValidateBeforeSaveCallback)
      return showExternalDataToolModal?.onValidateBeforeSaveCallback(newExternalDataTool)

    return true
  }

  return (
    <ModalContext.Provider value={{
      setShowAccountSettingModal,
      setShowApiBasedExtensionModal,
      setShowModerationSettingModal,
      setShowExternalDataToolModal,
      setShowPricingModal: () => setShowPricingModal(true),
      setShowAnnotationFullModal: () => setShowAnnotationFullModal(true),
      setShowModelModal,
    }}>
      <>
        {children}
        {
          !!showAccountSettingModal && (
            <AccountSetting
              activeTab={showAccountSettingModal.payload}
              onCancel={handleCancelAccountSettingModal}
            />
          )
        }

        {
          !!showApiBasedExtensionModal && (
            <ApiBasedExtensionModal
              data={showApiBasedExtensionModal.payload}
              onCancel={() => setShowApiBasedExtensionModal(null)}
              onSave={handleSaveApiBasedExtension}
            />
          )
        }
        {
          !!showModerationSettingModal && (
            <ModerationSettingModal
              data={showModerationSettingModal.payload}
              onCancel={handleCancelModerationSettingModal}
              onSave={handleSaveModeration}
            />
          )
        }
        {
          !!showExternalDataToolModal && (
            <ExternalDataToolModal
              data={showExternalDataToolModal.payload}
              onCancel={handleCancelExternalDataToolModal}
              onSave={handleSaveExternalDataTool}
              onValidateBeforeSave={handleValidateBeforeSaveExternalDataTool}
            />
          )
        }

        {
          !!showPricingModal && (
            <Pricing onCancel={() => {
              if (searchParams.get('show-pricing') === '1')
                router.push(location.pathname, { forceOptimisticNavigation: true } as any)

              setShowPricingModal(false)
            }} />
          )
        }

        {
          showAnnotationFullModal && (
            <AnnotationFullModal
              show={showAnnotationFullModal}
              onHide={() => setShowAnnotationFullModal(false)} />
          )
        }
        {
          !!showModelModal && (
            <ModelModal
              provider={showModelModal.payload.currentProvider}
              configurateMethod={showModelModal.payload.currentConfigurateMethod}
              currentCustomConfigrationModelFixedFields={showModelModal.payload.currentCustomConfigrationModelFixedFields}
              onCancel={handleCancelModelModal}
              onSave={handleSaveModelModal}
            />
          )
        }
      </>
    </ModalContext.Provider>
  )
}

export default ModalContext
